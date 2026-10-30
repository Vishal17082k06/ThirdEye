import { Bot, Camera, Cpu, Mic, ShieldAlert, Accessibility as A11yIcon, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Input, Select, Slider, Switch } from '../../design'
import { useResync } from '../../lib/useResync'
import { applyAccessibility, type TextSize } from '../../lib/a11y'
import {
  toPrefs,
  toServerTextSize,
  toTextSize,
  useEmailStatus,
  useUpdateSettings,
  type Settings,
} from '../../lib/settings'
import { useGuardian, guardianIsSet } from '../account/useAccount'
import { validateHost } from '../devices/validation'
import { SectionForm } from './SectionForm'

const icon = (I: typeof Camera) => <I className="h-5 w-5" aria-hidden="true" />
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/* ---------------- Camera ---------------- */

type CamState = 'checking' | 'unsupported' | 'needs_permission' | 'ready'

export function CameraSection({ settings }: { settings: Settings['camera'] }) {
  const update = useUpdateSettings()
  const initial = {
    deviceId: settings.deviceId ?? '',
    resolution: String(settings.preferences.resolution ?? '1280x720'),
    mirror: settings.preferences.mirror === true,
  }
  const [draft, setDraft] = useState(initial)
  useResync(initial, draft, setDraft)
  const { deviceId, resolution, mirror } = draft
  const setDeviceId = (v: string) => setDraft((d) => ({ ...d, deviceId: v }))
  const setResolution = (v: string) => setDraft((d) => ({ ...d, resolution: v }))
  const setMirror = (v: boolean) => setDraft((d) => ({ ...d, mirror: v }))
  const [cams, setCams] = useState<MediaDeviceInfo[]>([])
  const [state, setState] = useState<CamState>('checking')
  const [permError, setPermError] = useState<string | null>(null)

  const enumerate = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return setState('unsupported')
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const videos = all.filter((d) => d.kind === 'videoinput')
      setCams(videos)
      // Browsers hide device labels until camera permission has been granted.
      setState(videos.length > 0 && videos.every((d) => d.label) ? 'ready' : 'needs_permission')
    } catch {
      setState('needs_permission')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void enumerate()
  }, [enumerate])

  async function grant() {
    setPermError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch (err) {
      const name = (err as DOMException)?.name
      setPermError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in your browser site settings, then try again.'
          : name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : 'The camera could not be opened. Another app may be using it.',
      )
    }
    await enumerate()
  }

  const dirty = !same(draft, initial)

  return (
    <SectionForm
      id="settings-camera"
      title="Camera"
      description="Choose which camera Third Eye uses."
      icon={icon(Camera)}
      dirty={dirty}
      onSave={async () => {
        await update.mutateAsync({ camera: { deviceId: deviceId || null, preferences: { ...settings.preferences, resolution, mirror } } })
      }}
    >
      {state === 'unsupported' && (
        <p className="text-base text-muted">This browser cannot list cameras (it needs a secure https or localhost page).</p>
      )}
      {state === 'needs_permission' && (
        <div className="space-y-3 rounded-xl bg-surface-muted p-4">
          <p className="text-base text-ink">
            {cams.length === 0
              ? 'No camera is listed yet. Grant camera permission so the browser can show the cameras it finds.'
              : 'Camera names are hidden until you grant camera permission.'}
          </p>
          <Button variant="secondary" className="whitespace-normal!" onClick={grant} leftIcon={icon(Camera)}>
            Grant camera permission
          </Button>
          {permError && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {permError}
            </p>
          )}
        </div>
      )}
      {state === 'ready' && cams.length === 0 && <p className="text-base text-muted">No camera was found.</p>}
      {state === 'ready' && cams.length > 0 && (
        <Select label="Camera" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          <option value="">Browser default</option>
          {cams.map((c, i) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.label || `Camera ${i + 1}`}
            </option>
          ))}
        </Select>
      )}
      <Select label="Preferred resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
        <option value="640x480">640 x 480 (fastest)</option>
        <option value="1280x720">1280 x 720 (balanced)</option>
        <option value="1920x1080">1920 x 1080 (sharpest)</option>
      </Select>
      <Switch label="Mirror preview" description="Flip the camera preview horizontally." checked={mirror} onChange={setMirror} />
    </SectionForm>
  )
}

/* ---------------- Hardware ---------------- */

export function HardwareSection({ settings }: { settings: Settings['hardware'] }) {
  const update = useUpdateSettings()
  const initial = {
    ip: settings.deviceIp,
    poll: String(settings.pollingIntervalMs),
    alert: String(settings.sensorSettings.alertDistanceCm ?? 100),
  }
  const [v, setV] = useState(initial)
  useResync(initial, v, setV)
  const [errors, setErrors] = useState<Partial<Record<keyof typeof initial, string>>>({})
  const trimmed = (x: typeof initial) => ({ ip: x.ip.trim(), poll: x.poll.trim(), alert: x.alert.trim() })

  return (
    <SectionForm
      id="settings-hardware"
      title="Hardware"
      description="Defaults for the hardware controller and sensors."
      icon={icon(Cpu)}
      dirty={!same(trimmed(v), trimmed(initial))}
      onSave={async () => {
        const poll = Number(v.poll)
        const alert = Number(v.alert)
        const e = {
          ip: validateHost(v.ip),
          poll: Number.isInteger(poll) && poll >= 100 && poll <= 60000 ? undefined : 'Enter a whole number from 100 to 60000.',
          alert: Number.isFinite(alert) && alert >= 5 && alert <= 400 ? undefined : 'Enter a distance from 5 to 400 cm.',
        }
        setErrors(e)
        if (e.ip || e.poll || e.alert) return 'Fix the highlighted fields.'
        await update.mutateAsync({
          hardware: {
            deviceIp: v.ip.trim(),
            pollingIntervalMs: poll,
            sensorSettings: { ...settings.sensorSettings, alertDistanceCm: alert },
          },
        })
      }}
    >
      <Input
        label="Default hardware IP or hostname"
        value={v.ip}
        error={errors.ip}
        onChange={(e) => setV({ ...v, ip: e.target.value })}
        hint="Optional. Each device's own address is set on the Device Management page."
      />
      <Input
        label="Polling interval (ms)"
        inputMode="numeric"
        value={v.poll}
        error={errors.poll}
        onChange={(e) => setV({ ...v, poll: e.target.value })}
        hint="How often to ask hardware for a reading. 100 to 60000."
      />
      <Input
        label="Distance alert threshold (cm)"
        inputMode="numeric"
        value={v.alert}
        error={errors.alert}
        onChange={(e) => setV({ ...v, alert: e.target.value })}
        hint="Distance sensor readings closer than this count as an alert."
      />
    </SectionForm>
  )
}

/* ---------------- AI ---------------- */

export function AiSection({ settings }: { settings: Settings['ai'] }) {
  const update = useUpdateSettings()
  const initial = {
    conf: settings.confidenceThreshold,
    danger: String(settings.riskSettings.dangerDistanceM ?? 1.5),
    caution: String(settings.riskSettings.cautionDistanceM ?? 3),
    vision: settings.openaiVisionEnabled,
  }
  const [v, setV] = useState(initial)
  useResync(initial, v, setV)
  const [errors, setErrors] = useState<{ danger?: string; caution?: string }>({})

  return (
    <SectionForm
      id="settings-ai"
      title="AI"
      description="How sensitive obstacle detection should be."
      icon={icon(Bot)}
      dirty={!same(v, initial)}
      onSave={async () => {
        const danger = Number(v.danger)
        const caution = Number(v.caution)
        const e = {
          danger: Number.isFinite(danger) && danger >= 0.1 && danger <= 20 ? undefined : 'Enter a distance from 0.1 to 20 metres.',
          caution: Number.isFinite(caution) && caution > danger && caution <= 20 ? undefined : 'Enter a distance larger than the danger distance, up to 20 metres.',
        }
        setErrors(e)
        if (e.danger || e.caution) return 'Fix the highlighted fields.'
        await update.mutateAsync({
          ai: {
            confidenceThreshold: v.conf,
            openaiVisionEnabled: v.vision,
            riskSettings: { ...settings.riskSettings, dangerDistanceM: danger, cautionDistanceM: caution },
          },
        })
      }}
    >
      <Slider
        label="Detection confidence threshold"
        min={0.05}
        max={0.95}
        step={0.05}
        value={v.conf}
        display={`${Math.round(v.conf * 100)}%`}
        onChange={(conf) => setV({ ...v, conf: Math.round(conf * 100) / 100 })}
        hint="Detections below this confidence are ignored. Higher means fewer false alarms but more missed obstacles."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Input label="Danger distance (m)" inputMode="decimal" value={v.danger} error={errors.danger} onChange={(e) => setV({ ...v, danger: e.target.value })} hint="Obstacles closer than this are high risk." />
        <Input label="Caution distance (m)" inputMode="decimal" value={v.caution} error={errors.caution} onChange={(e) => setV({ ...v, caution: e.target.value })} hint="Obstacles closer than this are medium risk." />
      </div>
      <Switch
        label="Use OpenAI Vision"
        description="Optional extra image analysis. It only works when the server has an OpenAI key configured; otherwise it is skipped."
        checked={v.vision}
        onChange={(vision) => setV({ ...v, vision })}
      />
    </SectionForm>
  )
}

/* ---------------- Voice ---------------- */

export function VoiceSection({ settings }: { settings: Settings['voice'] }) {
  const update = useUpdateSettings()
  const initial = { enabled: settings.enabled, rate: settings.rate, voiceName: settings.voiceName ?? '', feedback: settings.feedback }
  const [v, setV] = useState(initial)
  useResync(initial, v, setV)
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth?.getVoices?.() ?? [])

  useEffect(() => {
    if (!synth) return
    const load = () => setVoices(synth.getVoices())
    load()
    synth.addEventListener?.('voiceschanged', load)
    return () => synth.removeEventListener?.('voiceschanged', load)
  }, [synth])

  function testVoice() {
    if (!synth) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance('This is Third Eye. Obstacle ahead, please slow down.')
    u.rate = v.rate
    const chosen = voices.find((x) => x.name === v.voiceName)
    if (chosen) u.voice = chosen
    synth.speak(u)
  }

  return (
    <SectionForm
      id="settings-voice"
      title="Voice"
      description="Spoken announcements and the voice assistant."
      icon={icon(Mic)}
      dirty={!same(v, initial)}
      onSave={async () => {
        await update.mutateAsync({ voice: { enabled: v.enabled, rate: v.rate, voiceName: v.voiceName || null, feedback: v.feedback } })
      }}
    >
      <Switch label="Enable voice assistant" checked={v.enabled} onChange={(enabled) => setV({ ...v, enabled })} />
      <Switch label="Spoken feedback" description="Announce detections and navigation steps aloud." checked={v.feedback} onChange={(feedback) => setV({ ...v, feedback })} />
      <Slider label="Speech rate" min={0.5} max={2} step={0.1} value={v.rate} display={`${v.rate.toFixed(1)}x`} onChange={(rate) => setV({ ...v, rate: Math.round(rate * 10) / 10 })} />
      {synth ? (
        <>
          <Select label="Voice" value={v.voiceName} onChange={(e) => setV({ ...v, voiceName: e.target.value })} hint={voices.length === 0 ? 'No voices reported yet by this browser.' : undefined}>
            <option value="">Browser default</option>
            {voices.map((x) => (
              <option key={`${x.name}-${x.lang}`} value={x.name}>
                {x.name} ({x.lang})
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={testVoice} leftIcon={icon(Volume2)}>
            Test voice
          </Button>
        </>
      ) : (
        <p className="text-base text-muted">This browser does not support speech output, so voice selection is unavailable.</p>
      )}
    </SectionForm>
  )
}

/* ---------------- Accessibility ---------------- */

export function AccessibilitySection({ settings }: { settings: Settings['accessibility'] }) {
  const update = useUpdateSettings()
  const initial = { textSize: toTextSize(settings.textSize), highContrast: settings.highContrast, largeButtons: settings.largeButtons }
  const [v, setV] = useState(initial)
  useResync(initial, v, setV)
  const savedRef = useRef(settings)
  useEffect(() => {
    savedRef.current = settings
  }, [settings])

  // Apply as the user changes things; leaving without saving restores what is stored.
  useEffect(() => {
    applyAccessibility(v)
  }, [v])
  useEffect(() => () => applyAccessibility(toPrefs(savedRef.current)), [])

  return (
    <SectionForm
      id="settings-accessibility"
      title="Accessibility"
      description="Changes preview immediately. Save to keep them on every device."
      icon={icon(A11yIcon)}
      dirty={!same(v, initial)}
      onSave={async () => {
        await update.mutateAsync({ accessibility: { textSize: toServerTextSize(v.textSize), highContrast: v.highContrast, largeButtons: v.largeButtons } })
      }}
    >
      <Select label="Text size" value={v.textSize} onChange={(e) => setV({ ...v, textSize: e.target.value as TextSize })}>
        <option value="normal">Medium (default)</option>
        <option value="lg">Large</option>
        <option value="xl">Extra large</option>
      </Select>
      <Switch label="High contrast" description="Black on white with thicker borders." checked={v.highContrast} onChange={(highContrast) => setV({ ...v, highContrast })} />
      <Switch label="Large buttons" description="Bigger touch targets for buttons and fields." checked={v.largeButtons} onChange={(largeButtons) => setV({ ...v, largeButtons })} />
    </SectionForm>
  )
}

/* ---------------- Emergency ---------------- */

export function EmergencySection({ settings }: { settings: Settings['emergency'] }) {
  const update = useUpdateSettings()
  const guardian = useGuardian()
  const email = useEmailStatus()
  const [contact, setContact] = useState(settings.contact)
  useResync(settings.contact, contact, setContact)
  const [error, setError] = useState<string | undefined>()

  return (
    <SectionForm
      id="settings-emergency"
      title="Emergency"
      description="Who is contacted when you press SOS."
      icon={icon(ShieldAlert)}
      dirty={contact !== settings.contact}
      onSave={async () => {
        if (contact.length > 200) {
          setError('Keep this under 200 characters.')
          return 'Fix the highlighted fields.'
        }
        setError(undefined)
        await update.mutateAsync({ emergency: { contact: contact.trim() } })
      }}
    >
      <div className="space-y-1 rounded-xl bg-surface-muted p-4">
        <p className="text-sm font-semibold text-muted">Guardian</p>
        {guardian.isPending ? (
          <p className="text-base text-muted">Loading</p>
        ) : guardian.data && guardianIsSet(guardian.data) ? (
          <p className="text-base text-ink">
            {guardian.data.name} ({guardian.data.relationship}) · {guardian.data.email} · {guardian.data.phone}
          </p>
        ) : (
          <p className="text-base text-ink">No guardian set yet.</p>
        )}
        <Link to="/profile" className="inline-flex min-h-[var(--control-h)] items-center font-bold text-primary underline underline-offset-4">
          Edit guardian in Profile
        </Link>
      </div>
      <Input label="Additional emergency contact" value={contact} error={error} onChange={(e) => setContact(e.target.value)} hint="Optional note, such as a second number or a neighbour." />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-base font-semibold text-ink">Email delivery</span>
        {email.isPending ? (
          <Badge>Checking</Badge>
        ) : email.isError ? (
          <Badge tone="warning">Status unavailable</Badge>
        ) : email.data.configured ? (
          <Badge tone="success">Configured</Badge>
        ) : (
          <Badge tone="danger" className="whitespace-normal! text-left">Not configured: SOS emails cannot be sent</Badge>
        )}
      </div>
    </SectionForm>
  )
}
