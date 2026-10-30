import { Battery, Camera, FlaskConical, Radar, Save, Vibrate, Video, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Input, Spinner, useToast, type BadgeTone } from '../../design'
import { ApiError } from '../../lib/api'
import { useMode } from '../../lib/mode'
import { absoluteTime, relativeTime } from '../../lib/relativeTime'
import { ErrorBanner } from '../auth/FormBanner'
import { validateHost } from './validation'
import {
  probeCamera,
  useDevices,
  useReportLaptopCamera,
  useSaveDeviceConfig,
  type Device,
  type DeviceKey,
  type DeviceStatusValue,
} from './useDevices'

export const STATUS_LABEL: Record<DeviceStatusValue, { label: string; tone: BadgeTone }> = {
  connected: { label: 'Connected', tone: 'success' },
  disconnected: { label: 'Disconnected', tone: 'warning' },
  not_integrated: { label: 'Not integrated', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
}

const ICON: Record<DeviceKey, LucideIcon> = {
  laptop_camera: Camera,
  esp32_cam: Video,
  vl53l0x: Radar,
  vibration_motor: Vibrate,
  battery: Battery,
}

const INFO: Record<DeviceKey, string> = {
  laptop_camera: 'Built-in or USB webcam used through your browser. Its status is only what this browser last reported.',
  esp32_cam: 'Wireless camera module. Separate from the laptop camera.',
  vl53l0x: 'Time-of-flight laser distance sensor. Connected only after it sends a verified hardware heartbeat.',
  vibration_motor: 'Haptic motor for silent alerts.',
  battery: 'Battery level monitor for the wearable hardware.',
}

/** Honest default explanation when the device is not connected and has no error message of its own. */
function stateMessage(d: Device): string | null {
  if (d.error) return d.error
  switch (d.status) {
    case 'not_integrated':
      return 'Hardware integration is not available yet.'
    case 'disconnected':
      return d.last_seen ? 'The device stopped reporting.' : 'No hardware heartbeat has been received yet.'
    case 'unknown':
      return d.key === 'laptop_camera' ? 'Not checked recently. Use Check camera to test it.' : 'Status is not known.'
    default:
      return null
  }
}

function useTick(ms: number) {
  const [, setN] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setN((n) => n + 1), ms)
    return () => window.clearInterval(id)
  }, [ms])
}

function IpForm({ device }: { device: Device }) {
  const save = useSaveDeviceConfig()
  const toast = useToast()
  const saved = typeof device.config.ip === 'string' ? device.config.ip : ''
  const [ip, setIp] = useState(saved)
  const [error, setError] = useState<string | undefined>()
  const [serverError, setServerError] = useState<string | null>(null)
  const id = `ip-${device.key}`

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const problem = validateHost(ip)
    setError(problem)
    if (problem) return
    try {
      const d = await save.mutateAsync({ key: device.key, config: { ip: ip.trim() } })
      setIp(typeof d.config.ip === 'string' ? d.config.ip : '')
      toast.show({ tone: 'success', title: `${device.name} address saved` })
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      {serverError && <ErrorBanner message={serverError} />}
      <Input
        id={id}
        label="Device IP or hostname"
        value={ip}
        error={error}
        onChange={(e) => setIp(e.target.value)}
        hint="Saving an address does not mark the device connected."
      />
      <Button type="submit" variant="secondary" loading={save.isPending} leftIcon={<Save className="h-5 w-5" aria-hidden="true" />}>
        {save.isPending ? 'Saving' : 'Save address'}
      </Button>
    </form>
  )
}

function CameraCheck() {
  const report = useReportLaptopCamera()
  const toast = useToast()
  const [checking, setChecking] = useState(false)

  async function check() {
    setChecking(true)
    try {
      const result = await probeCamera()
      await report.mutateAsync(result)
      toast.show({
        tone: result.status === 'connected' ? 'success' : 'warning',
        title: result.status === 'connected' ? 'Camera works' : result.status === 'disconnected' ? 'No camera found' : 'Camera problem',
        message: result.error,
      })
    } catch (err) {
      toast.show({ tone: 'error', title: 'Could not report the camera result', message: err instanceof ApiError ? err.message : undefined })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-3">
      <Button variant="secondary" loading={checking} onClick={check} leftIcon={<Camera className="h-5 w-5" aria-hidden="true" />}>
        {checking ? 'Checking' : 'Check camera'}
      </Button>
      <p className="text-sm text-muted">
        Opens the camera for a moment, then closes it.{' '}
        <Link to="/settings#settings-camera" className="font-bold text-primary underline underline-offset-4">
          Choose a camera in Settings
        </Link>
      </p>
    </div>
  )
}

function DeviceCard({ device }: { device: Device }) {
  const Icon = ICON[device.key]
  const shown = STATUS_LABEL[device.status] ?? STATUS_LABEL.unknown
  const message = stateMessage(device)
  const rawInfo = device.config.lastInfo
  const info = rawInfo && typeof rawInfo === 'object' ? (rawInfo as Record<string, unknown>) : null
  const titleId = `device-${device.key}`

  return (
    <Card as="article" aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <h2 id={titleId} className="text-lg font-bold text-ink">
            {device.name}
          </h2>
          <p className="text-sm text-muted">{INFO[device.key]}</p>
        </div>
        <Badge tone={shown.tone} className="shrink-0">{shown.label}</Badge>
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold text-muted">Last communication</dt>
        <dd className="text-ink">
          {device.last_seen ? (
            <time dateTime={device.last_seen} title={absoluteTime(device.last_seen)}>
              {relativeTime(device.last_seen)}
            </time>
          ) : (
            'Never'
          )}
        </dd>
        {info && Object.keys(info).length > 0 && (
          <>
            <dt className="font-semibold text-muted">Last reported</dt>
            <dd className="text-ink">
              {Object.entries(info)
                .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
                .join(', ')}
            </dd>
          </>
        )}
      </dl>

      {message && (
        <p
          className={`bw rounded-xl p-3 text-sm font-semibold ${device.status === 'error' ? 'border-danger bg-danger-soft text-danger' : 'border-line bg-surface-muted text-muted'}`}
          role={device.status === 'error' ? 'alert' : undefined}
        >
          {message}
        </p>
      )}

      <div className="mt-auto border-t border-line pt-4">
        {device.key === 'laptop_camera' ? <CameraCheck /> : <IpForm device={device} />}
      </div>
    </Card>
  )
}

export function Devices() {
  const q = useDevices()
  const { mode } = useMode()
  useTick(30_000)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Device Management</h1>
        <p className="mt-1 text-base text-muted">
          A device shows Connected only when it has really reported in. This page refreshes every 10 seconds.
        </p>
      </div>

      {mode === 'simulation' && (
        <div role="note" className="bw flex items-start gap-3 rounded-xl border-sim bg-sim-soft p-4 text-sim">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="font-semibold">
            Simulation mode: simulated data never changes device status. Statuses below reflect real reports only.
          </p>
        </div>
      )}

      {q.isPending && <Spinner label="Loading devices" />}
      {q.isError && !q.data && (
        <div className="space-y-3">
          <ErrorBanner message={q.error instanceof ApiError ? q.error.message : 'Could not load devices.'} />
          <Button variant="secondary" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {q.data && (
        <>
          {q.isError && <ErrorBanner message="Could not refresh devices. Showing the last known state." />}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {q.data.map((d) => (
              <DeviceCard key={d.key} device={d} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
