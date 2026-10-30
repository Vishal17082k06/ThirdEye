import { Camera, CameraOff, FlaskConical, Radar, ScanSearch, Square, Upload, VideoOff, History as HistoryIcon, Gauge } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, CardHeader, EmptyState, Select, Spinner } from '../../design'
import { useCamera } from '../../hooks/useCamera'
import { useSpeech, type Risk } from '../../hooks/useSpeech'
import { ApiError } from '../../lib/api'
import type { ClientEventSource } from '../../lib/events'
import { useMode } from '../../lib/mode'
import { ErrorBanner } from '../auth/FormBanner'
import { findApproaching, withApproach } from './approach'
import { detectImage, EngineUnavailableError, validateImageFile, type Detection, type DetectResult } from './detect'
import { DetectionCanvas } from './DetectionCanvas'
import { DetectionList, HonestyNote, RiskBadge, RiskLegend, SimulatedBadge } from './parts'
import { aiController, useAiControllerState, type AiResult } from './aiController'
import { useDetectionLoop } from './useDetectionLoop'
import { SimulationSection } from '../simulation/SimulationSection'

export type Origin = 'camera' | 'capture' | 'upload' | 'simulated'

interface Current {
  result: DetectResult
  origin: Origin
  /** Announcement text after temporal analysis (usually the server's own summary). */
  text: string
}

export interface HistoryEntry {
  id: number
  at: number
  text: string
  risk: Risk | null
  origin: Origin
  source: ClientEventSource
}

interface Spoken {
  text: string
  assertive: boolean
  n: number
}

const HISTORY_LIMIT = 50
const ORIGIN_LABEL: Record<Origin, string> = {
  camera: 'Live camera',
  capture: 'Captured image',
  upload: 'Uploaded image',
  simulated: 'Simulated scenario',
}

function Section({ children }: { children: ReactNode }) {
  return <div className="space-y-6">{children}</div>
}

export function AiAssistance() {
  const { mode } = useMode()
  const simulation = mode === 'simulation'
  const source: ClientEventSource = simulation ? 'simulation' : 'live'
  const camera = useCamera()
  const { announce, cancel: cancelSpeech, resetDedupe } = useSpeech()

  const [detecting, setDetecting] = useState(false)
  const [current, setCurrent] = useState<Current | null>(null)
  const [engineDown, setEngineDown] = useState<string | null>(null)
  const [loopError, setLoopError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [spoken, setSpoken] = useState<Spoken>({ text: '', assertive: false, n: 0 })
  const [aspect, setAspect] = useState(16 / 9)
  const recent = useRef<Detection[][]>([])
  const nextId = useRef(1)

  const cameraActive = camera.status === 'active'

  /** One place every result goes through: current view, announcement (deduped), live region and history. */
  const present = useCallback(
    (result: DetectResult, origin: Origin, manual = false) => {
      let text = result.summary.text
      let risk = result.summary.highest_risk
      if (origin === 'camera') {
        // "Vehicle approaching" needs evidence across frames; the server only says "Vehicle ahead".
        const approaching = findApproaching(recent.current, result.detections)
        const merged = withApproach(result, approaching)
        text = merged.text
        risk = merged.risk
        recent.current = [...recent.current, result.detections].slice(-3)
      }
      setCurrent({ result, origin, text })
      const announced = announce(text, risk)
      // Live region and speech update on new announcements and on repeats of a hazard still in view.
      if (announced || manual) setSpoken((s) => ({ text, assertive: risk === 'high' || risk === 'critical', n: s.n + 1 }))
      // History only records something new, never the repeats.
      if (announced === 'new' || manual) {
        setHistory((h) =>
          [{ id: nextId.current++, at: Date.now(), text, risk, origin, source }, ...h].slice(0, HISTORY_LIMIT),
        )
      }
    },
    [announce, source],
  )

  // Detection only makes sense while the camera is running.
  useEffect(() => {
    if (!cameraActive) setDetecting(false)
  }, [cameraActive])

  // Leaving detection: stop speech and drop the stale live result so it is never mistaken for current.
  const wasDetecting = useRef(false)
  useEffect(() => {
    if (detecting) {
      wasDetecting.current = true
      return
    }
    if (!wasDetecting.current) return
    wasDetecting.current = false
    cancelSpeech()
    recent.current = []
    setCurrent((c) => (c?.origin === 'camera' ? null : c))
  }, [detecting, cancelSpeech])

  useDetectionLoop({
    enabled: detecting && cameraActive,
    source,
    captureFrame: camera.captureFrame,
    onResult: (r) => present(r, 'camera'),
    onUnavailable: (message) => {
      setEngineDown(message)
      setDetecting(false)
    },
    onError: (message, fatal) => {
      setLoopError(fatal ? `${message} Detection was stopped after repeated failures.` : message)
      if (fatal) setDetecting(false)
    },
  })

  function startDetection() {
    setEngineDown(null)
    setLoopError(null)
    resetDedupe()
    setDetecting(true)
  }

  /* ---------- commands from the voice assistant (see aiController) ---------- */
  const voiceRef = useRef({ camera, detecting, startDetection })
  voiceRef.current = { camera, detecting, startDetection }
  const gesturePrompt = useAiControllerState().gesturePrompt

  useEffect(() => {
    aiController.publishStatus({ camera: camera.status, detecting })
    if (camera.status === 'active') aiController.setGesturePrompt(null)
  }, [camera.status, detecting])

  useEffect(() => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const camNow = () => voiceRef.current.camera
    /** Starts the camera and waits for the real outcome (the permission prompt may stay open for a while). */
    async function bringUpCamera(): Promise<AiResult> {
      if (camNow().status === 'active') return { ok: true, message: 'The camera is already on.' }
      void voiceRef.current.camera.start()
      await sleep(150)
      for (let waited = 0; camNow().status === 'requesting' && waited < 30_000; waited += 100) await sleep(100)
      if (camNow().status === 'active') return { ok: true, message: 'The camera is on.' }
      const why = voiceRef.current.camera.message
      // Some browsers only open the camera from a tap: leave a visible "Start camera" prompt on the page.
      aiController.setGesturePrompt(why ?? 'The browser did not start the camera. Use the Start camera button.')
      return { ok: false, message: `${why ?? 'The browser did not start the camera.'} Tap Start camera on the AI Assistance page.` }
    }
    return aiController.attach(async (command) => {
      switch (command) {
        case 'startCamera':
          return bringUpCamera()
        case 'stopCamera':
          if (voiceRef.current.camera.status !== 'active') return { ok: true, message: 'The camera is already off.' }
          voiceRef.current.camera.stop()
          return { ok: true, message: 'The camera is off.' }
        case 'startDetection': {
          const cam = await bringUpCamera()
          if (!cam.ok) return { ok: false, message: `Obstacle detection was not started. ${cam.message}` }
          if (voiceRef.current.detecting) return { ok: true, message: 'Obstacle detection is already on.' }
          voiceRef.current.startDetection()
          return { ok: true, message: 'Obstacle detection is on.' }
        }
        case 'stopDetection':
          if (!voiceRef.current.detecting) return { ok: true, message: 'Obstacle detection is already off.' }
          setDetecting(false)
          return { ok: true, message: 'Obstacle detection is off.' }
      }
    })
  }, [])

  /* ---------- still image analysis (upload and capture) ---------- */
  const [image, setImage] = useState<{ blob: Blob; url: string; name: string; origin: Origin } | null>(null)
  const [imageResult, setImageResult] = useState<DetectResult | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(
    () => () => {
      controller.current?.abort()
      if (urlRef.current) URL.revokeObjectURL?.(urlRef.current)
    },
    [],
  )

  function setStill(blob: Blob, name: string, origin: Origin) {
    if (urlRef.current) URL.revokeObjectURL?.(urlRef.current)
    const url = URL.createObjectURL(blob)
    urlRef.current = url
    setImage({ blob, url, name, origin })
    setImageResult(null)
    setImageError(null)
  }

  async function analyse(blob: Blob, origin: Origin) {
    controller.current?.abort()
    const c = new AbortController()
    controller.current = c
    setBusy(true)
    setImageError(null)
    try {
      // Manual analysis is always recorded; the server tags the event with the current source.
      const result = await detectImage(blob, { source, record: true, signal: c.signal })
      setEngineDown(null)
      setImageResult(result)
      present(result, origin, true)
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
      if (err instanceof EngineUnavailableError) {
        setEngineDown(err.message)
        setImageResult(null)
      } else {
        setImageError(err instanceof ApiError || err instanceof Error ? err.message : 'The image could not be analysed.')
      }
    } finally {
      if (controller.current === c) setBusy(false)
    }
  }

  function chooseFile(file: File | undefined) {
    if (!file) return
    const problem = validateImageFile(file)
    if (problem) {
      setImageError(problem)
      return
    }
    setStill(file, file.name, 'upload')
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    chooseFile(e.dataTransfer.files?.[0])
  }

  async function capture() {
    try {
      const blob = await camera.captureFrame()
      setStill(blob, 'Captured from camera', 'capture')
      await analyse(blob, 'capture')
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Could not capture an image.')
    }
  }

  const shown = current?.origin === 'camera' ? current : null
  const latest = current
  const cameraProblem = ['denied', 'no-device', 'error'].includes(camera.status)

  return (
    <Section>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">AI Assistance</h1>
        <p className="mt-1 text-base text-muted">
          {simulation
            ? 'Try obstacle detection with your camera, uploaded images, or simulated scenarios.'
            : 'Use your camera or an image to find obstacles. Results are announced aloud.'}
        </p>
      </div>

      {simulation && (
        <div role="note" className="bw flex items-start gap-3 rounded-xl border-sim bg-sim-soft p-4 text-sim">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="font-semibold">
            SIMULATION MODE. Camera frames and images you send here are analysed by the real detector but recorded as
            simulation. Simulated scenarios are canned examples and never touch real device status.
          </p>
        </div>
      )}

      <HonestyNote />

      {engineDown && (
        <div role="alert" className="bw space-y-1 rounded-xl border-danger bg-danger-soft p-4 text-danger">
          <p className="flex items-center gap-2 font-bold">
            <VideoOff className="h-5 w-5" aria-hidden="true" /> Detection engine unavailable
          </p>
          <p>{engineDown}</p>
          <p className="text-sm">No detections are shown because none were produced. The camera and image upload still work, but nothing can be analysed until the engine is available.</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card as="section" aria-labelledby="camera-heading" className="lg:col-span-3">
          <CardHeader
            id="camera-heading"
            title="Camera"
            description={simulation ? 'Live camera, used for testing in Simulation mode.' : 'Your laptop or USB webcam.'}
            icon={<Camera className="h-5 w-5" aria-hidden="true" />}
            action={
              cameraActive ? (
                <Badge tone="success">Camera on</Badge>
              ) : (
                <Badge tone="neutral">Camera off</Badge>
              )
            }
          />
          <div
            className="relative w-full overflow-hidden rounded-xl bg-slate-900"
            style={{ aspectRatio: aspect }}
          >
            <video
              ref={camera.videoRef}
              muted
              playsInline
              aria-label="Live camera preview"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
              }}
              className={`absolute inset-0 h-full w-full object-fill ${cameraActive ? '' : 'invisible'}`}
              style={camera.mirror ? { transform: 'scaleX(-1)' } : undefined}
            />
            {cameraActive && shown && (
              <DetectionCanvas detections={shown.result.detections} width={shown.result.image.width} height={shown.result.image.height} mirrored={camera.mirror} />
            )}
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white">
                {camera.status === 'requesting' ? (
                  <Spinner label="Waiting for camera permission" />
                ) : (
                  <>
                    <CameraOff className="h-10 w-10" aria-hidden="true" />
                    <p className="font-semibold">{cameraProblem ? 'Camera unavailable' : 'Camera is off'}</p>
                  </>
                )}
              </div>
            )}
            {detecting && cameraActive && (
              <span className="absolute left-3 top-3 rounded-full bg-white px-3 py-0.5 text-sm font-bold text-ink">Detecting obstacles</span>
            )}
          </div>

          {camera.message && <div className="mt-3"><ErrorBanner message={camera.message} /></div>}
          {gesturePrompt && !cameraActive && (
            <div role="status" className="bw mt-3 rounded-xl border-line-strong bg-surface-muted p-3 text-sm">
              <p className="font-semibold text-ink">Voice assistant asked to start the camera</p>
              <p className="mt-1 text-muted">{gesturePrompt} Press the button to start it yourself.</p>
              <Button className="mt-2" onClick={() => void camera.start()} leftIcon={<Camera className="h-5 w-5" aria-hidden="true" />}>
                Start camera
              </Button>
            </div>
          )}
          {loopError && <div className="mt-3"><ErrorBanner message={loopError} /></div>}

          {camera.devices.length > 1 && (
            <div className="mt-4">
              <Select
                label="Camera device"
                value={camera.selectedDeviceId}
                onChange={(e) => void camera.selectDevice(e.target.value)}
              >
                {!camera.selectedDeviceId && <option value="">Default camera</option>}
                {camera.devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </Select>
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Button
              onClick={() => void camera.start()}
              disabled={cameraActive}
              loading={camera.status === 'requesting'}
              leftIcon={<Camera className="h-5 w-5" aria-hidden="true" />}
            >
              Start camera
            </Button>
            <Button variant="secondary" onClick={camera.stop} disabled={!cameraActive} leftIcon={<CameraOff className="h-5 w-5" aria-hidden="true" />}>
              Stop camera
            </Button>
            <Button variant="secondary" onClick={() => void capture()} disabled={!cameraActive || busy} leftIcon={<ScanSearch className="h-5 w-5" aria-hidden="true" />}>
              Capture image
            </Button>
            {detecting ? (
              <Button variant="danger" onClick={() => setDetecting(false)} leftIcon={<Square className="h-5 w-5" aria-hidden="true" />}>
                Stop obstacle detection
              </Button>
            ) : (
              <Button onClick={startDetection} disabled={!cameraActive} leftIcon={<Radar className="h-5 w-5" aria-hidden="true" />}>
                Start obstacle detection
              </Button>
            )}
          </div>
          {!cameraActive && <p className="mt-2 text-sm text-muted">Start the camera to capture images or detect obstacles.</p>}
        </Card>

        <Card as="section" aria-labelledby="results-heading" className="lg:col-span-2">
          <CardHeader
            id="results-heading"
            title="Results"
            description={latest ? ORIGIN_LABEL[latest.origin] : 'Nothing analysed yet.'}
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            action={latest?.origin === 'simulated' ? <SimulatedBadge /> : undefined}
          />
          {latest ? (
            <div className="space-y-4">
              <div className="bw rounded-xl border-line bg-surface-muted p-3">
                <p className="text-sm font-semibold text-muted">Scene summary</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-bold text-ink">
                  <span data-testid="summary-text">{latest.text}</span>
                  {latest.result.summary.highest_risk && <RiskBadge risk={latest.result.summary.highest_risk} />}
                </p>
              </div>
              <DetectionList detections={latest.result.detections} />
              {latest.origin !== 'simulated' && (
                <p className="text-xs text-muted">
                  {latest.result.model}, {Math.round(latest.result.inference_ms)} ms
                </p>
              )}
            </div>
          ) : (
            <EmptyState
              icon={<Radar className="h-6 w-6" aria-hidden="true" />}
              title="No detections to show"
              description="Start obstacle detection, capture an image, or upload one. Detections appear here only when the detector really finds them."
            />
          )}
        </Card>
      </div>

      <Card as="section" aria-labelledby="upload-heading">
        <CardHeader
          id="upload-heading"
          title="Analyse an image"
          description="Upload a JPEG or PNG up to 10 MB, or capture one from the camera."
          icon={<Upload className="h-5 w-5" aria-hidden="true" />}
        />
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`bw flex flex-col items-center gap-3 rounded-xl border-dashed p-5 text-center ${dragging ? 'border-primary bg-primary-soft' : 'border-line-strong bg-surface-muted'}`}
        >
          <p className="text-base text-ink">Drag an image here, or</p>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png"
            aria-label="Choose an image to analyse"
            className="sr-only"
            onChange={(e) => {
              chooseFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button variant="secondary" onClick={() => fileInput.current?.click()} leftIcon={<Upload className="h-5 w-5" aria-hidden="true" />}>
            Choose image
          </Button>
        </div>
        {imageError && <div className="mt-3"><ErrorBanner message={imageError} /></div>}
        {image && (
          <div className="mt-4 space-y-3">
            <div className="relative inline-block max-w-full overflow-hidden rounded-xl bg-slate-900">
              <img src={image.url} alt={`Preview of ${image.name}`} className="block max-h-96 w-auto max-w-full" />
              {imageResult && (
                <DetectionCanvas detections={imageResult.detections} width={imageResult.image.width} height={imageResult.image.height} />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={busy} onClick={() => void analyse(image.blob, image.origin)} leftIcon={<ScanSearch className="h-5 w-5" aria-hidden="true" />}>
                {busy ? 'Analysing' : 'Analyse'}
              </Button>
              <span className="text-sm text-muted">{image.name}</span>
              {simulation && <SimulatedBadge />}
            </div>
            {imageResult && (
              <div className="bw rounded-xl border-line bg-surface-muted p-3">
                <p className="text-sm font-semibold text-muted">Image summary</p>
                <p className="text-lg font-bold text-ink">{imageResult.summary.text}</p>
                <div className="mt-2"><DetectionList detections={imageResult.detections} /></div>
              </div>
            )}
          </div>
        )}
      </Card>

      {simulation && <SimulationSection onScenario={(r) => present(r, 'simulated', true)} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section" aria-labelledby="history-heading">
          <CardHeader
            id="history-heading"
            title="Session history"
            description="Announcements from this visit, newest first."
            icon={<HistoryIcon className="h-5 w-5" aria-hidden="true" />}
          />
          {history.length === 0 ? (
            <EmptyState title="No detections yet" description="Announcements you hear will be listed here." />
          ) : (
            <ul className="divide-y divide-line" aria-label="Detection history">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{h.text}</p>
                    <p className="text-sm text-muted">
                      {new Date(h.at).toLocaleTimeString()} · {ORIGIN_LABEL[h.origin]}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    {h.origin === 'simulated' && <SimulatedBadge />}
                    {h.risk && <RiskBadge risk={h.risk} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4">
            <Link to="/history" className="font-bold text-primary underline underline-offset-4">
              View in Activity History
            </Link>
          </p>
        </Card>

        <Card as="section" aria-labelledby="legend-heading">
          <CardHeader id="legend-heading" title="Risk levels" description="Boxes use colour and a line style." icon={<Gauge className="h-5 w-5" aria-hidden="true" />} />
          <RiskLegend />
        </Card>
      </div>

      {/* Screen readers: urgent warnings interrupt, everything else waits its turn. */}
      <div className="sr-only">
        <div aria-live="assertive" aria-atomic="true" data-testid="live-assertive">{spoken.assertive ? spoken.text + (spoken.n % 2 ? '' : '​') : ''}</div>
        <div aria-live="polite" aria-atomic="true" data-testid="live-polite">{spoken.assertive ? '' : spoken.text + (spoken.n % 2 ? '' : '​')}</div>
      </div>
    </Section>
  )
}
