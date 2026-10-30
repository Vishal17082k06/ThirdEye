import { useCallback, useEffect, useRef, useState } from 'react'
import { useReportLaptopCamera, type CameraReport } from '../features/devices/useDevices'
import { postEvent } from '../lib/events'
import { useMode } from '../lib/mode'
import { useSettings } from '../lib/settings'

export type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'no-device' | 'error'

export const KEEPALIVE_MS = 30_000
export const MAX_FRAME_SIDE = 1280
export const FRAME_QUALITY = 0.8

export interface CameraInfo {
  deviceId: string
  label: string
}

/** Maps a getUserMedia failure to a status and a message a person can act on. */
export function describeCameraError(err: unknown): { status: CameraStatus; message: string } {
  const name = (err as DOMException | undefined)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { status: 'denied', message: 'Camera permission was denied. Allow camera access in your browser settings, then try again.' }
    case 'NotFoundError':
      return { status: 'no-device', message: 'No camera was found on this device. Connect a camera and try again.' }
    case 'NotReadableError':
      return { status: 'error', message: 'The camera is in use by another application or could not be started. Close other apps using it and try again.' }
    case 'OverconstrainedError':
      return { status: 'error', message: 'The selected camera is not available. Choose another camera or pick the default.' }
    default:
      return { status: 'error', message: 'The camera could not be opened.' }
  }
}

/** Size a frame so its longest side is at most `max`, never upscaling. */
export function fitFrame(width: number, height: number, max = MAX_FRAME_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Browser camera for the AI page.
 * - Live mode reports laptop-camera status to the server on start/stop/errors and every 30 s while active
 *   (the server treats 60 s of silence as unknown). Simulation mode never reports device status.
 * - camera_session events (start, and stop with duration) are tagged with the current mode's source.
 * - Tracks are always stopped on stop, unmount and when the camera is unplugged.
 */
export function useCamera() {
  const { mode } = useMode()
  const source = mode === 'simulation' ? 'simulation' : 'live'
  const settings = useSettings().data?.camera
  const report = useReportLaptopCamera()
  const reportRef = useRef(report.mutateAsync)
  reportRef.current = report.mutateAsync
  const sourceRef = useRef(source)
  sourceRef.current = source

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startedAt = useRef<number | null>(null)
  const keepalive = useRef<number | undefined>(undefined)
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [devices, setDevices] = useState<CameraInfo[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const mirror = settings?.preferences?.mirror === true
  const selectedDeviceId = chosen ?? settings?.deviceId ?? ''

  const sendReport = useCallback((body: CameraReport) => {
    if (sourceRef.current === 'simulation') return // simulated use never changes real device status
    void reportRef.current(body).catch(() => undefined)
  }, [])

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(
        all
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })),
      )
    } catch {
      /* the list is optional */
    }
  }, [])

  const release = useCallback(() => {
    window.clearInterval(keepalive.current)
    keepalive.current = undefined
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const logSessionEnd = useCallback((reason: string) => {
    if (startedAt.current === null) return
    const seconds = Math.round((Date.now() - startedAt.current) / 1000)
    startedAt.current = null
    void postEvent({
      type: 'camera_session',
      source: sourceRef.current,
      title: 'Camera session ended',
      details: { durationSeconds: seconds, reason },
      status: 'stopped',
    })
  }, [])

  const stop = useCallback(() => {
    const wasActive = streamRef.current !== null
    release()
    if (wasActive) {
      logSessionEnd('stopped')
      sendReport({ status: 'disconnected' })
    }
    setStatus('idle')
    setMessage(null)
  }, [release, logSessionEnd, sendReport])

  const fail = useCallback(
    (err: unknown, override?: string) => {
      const wasActive = streamRef.current !== null
      release()
      if (wasActive) logSessionEnd('error')
      const d = describeCameraError(err)
      const text = override ?? d.message
      setStatus(d.status)
      setMessage(text)
      sendReport({ status: d.status === 'no-device' ? 'disconnected' : 'error', error: text })
    },
    [release, logSessionEnd, sendReport],
  )

  const handleDisconnect = useCallback(() => {
    release()
    logSessionEnd('disconnected')
    setStatus('no-device')
    setMessage('The camera was disconnected.')
    sendReport({ status: 'disconnected', error: 'The camera was disconnected.' })
  }, [release, logSessionEnd, sendReport])

  const start = useCallback(
    async (deviceId?: string) => {
      if (streamRef.current) return
      if (!navigator.mediaDevices?.getUserMedia) {
        fail({ name: 'UnsupportedError' }, 'This browser cannot access cameras (it needs https or localhost).')
        return
      }
      setStatus('requesting')
      setMessage(null)
      const wanted = deviceId ?? selectedDeviceId
      const m = /^(\d+)x(\d+)$/.exec(String(settings?.preferences?.resolution ?? ''))
      const video: MediaTrackConstraints = {
        ...(wanted ? { deviceId: { exact: wanted } } : {}),
        ...(m ? { width: { ideal: Number(m[1]) }, height: { ideal: Number(m[2]) } } : {}),
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: Object.keys(video).length ? video : true })
        streamRef.current = s
        setStream(s)
        startedAt.current = Date.now()
        setStatus('active')
        // Device labels are only available once permission has been granted.
        void refreshDevices()
        sendReport({ status: 'connected' })
        void postEvent({ type: 'camera_session', source: sourceRef.current, title: 'Camera session started', status: 'started' })
        keepalive.current = window.setInterval(() => sendReport({ status: 'connected' }), KEEPALIVE_MS)
        // An unplugged camera ends its track: treat that as a disconnect, not a frozen picture.
        s.getVideoTracks().forEach((t) =>
          t.addEventListener?.('ended', () => {
            if (streamRef.current === s) handleDisconnect()
          }),
        )
      } catch (err) {
        fail(err)
      }
    },
    [fail, handleDisconnect, refreshDevices, selectedDeviceId, sendReport, settings?.preferences?.resolution],
  )

  const selectDevice = useCallback(
    async (deviceId: string) => {
      setChosen(deviceId)
      if (streamRef.current) {
        // Switch cameras: close the old one quietly (no disconnect report), then open the new one.
        release()
        await start(deviceId)
      }
    },
    [release, start],
  )

  // Attach the stream to the page's <video> whenever it changes.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !stream) return
    v.srcObject = stream
    void v.play?.()?.catch?.(() => undefined)
  }, [stream])

  // Devices appear and vanish: refresh the list and stop if the active camera is gone.
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.addEventListener) return
    const onChange = async () => {
      await refreshDevices()
      const track = streamRef.current?.getVideoTracks()[0]
      if (track && track.readyState === 'ended') handleDisconnect()
    }
    md.addEventListener('devicechange', onChange)
    void refreshDevices()
    return () => md.removeEventListener('devicechange', onChange)
  }, [refreshDevices, handleDisconnect])

  // Always release the camera when the page goes away.
  useEffect(
    () => () => {
      const wasActive = streamRef.current !== null
      release()
      if (wasActive) {
        logSessionEnd('left page')
        sendReport({ status: 'disconnected' })
      }
    },
    [release, logSessionEnd, sendReport],
  )

  /** Current video frame as a JPEG (max 1280 px longest side, quality 0.8), mirrored if the setting is on. */
  const captureFrame = useCallback(async (): Promise<Blob> => {
    const v = videoRef.current
    if (!v || !streamRef.current || !v.videoWidth || !v.videoHeight) throw new Error('The camera is not ready yet.')
    const { width, height } = fitFrame(v.videoWidth, v.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not prepare the image.')
    if (mirror) {
      ctx.translate(width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(v, 0, 0, width, height)
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), 'image/jpeg', FRAME_QUALITY),
    )
  }, [mirror])

  return { status, message, devices, selectedDeviceId, selectDevice, start, stop, captureFrame, videoRef, mirror, source }
}
