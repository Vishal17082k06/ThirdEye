import {
  Battery,
  Bot,
  Camera,
  Car,
  CalendarClock,
  Cpu,
  MapPin,
  Mic,
  Navigation,
  Radar,
  ShieldAlert,
  Vibrate,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, buttonClasses, Card, CardHeader, EmptyState, type BadgeTone } from '../../design'
import { useAuth } from '../../lib/auth'
import { useMode } from '../../lib/mode'
import { isSpeechRecognitionSupported, useGpsPermission, type GpsState } from './useBrowserSignals'
import { useDashboardData, type ActivityItem, type DeviceStatus, type SosStatus } from './useDashboardData'

interface Shown {
  label: string
  tone: BadgeTone
}

const DEVICE: Record<DeviceStatus, Shown> = {
  connected: { label: 'Connected', tone: 'success' },
  disconnected: { label: 'Disconnected', tone: 'warning' },
  not_integrated: { label: 'Not integrated', tone: 'neutral' },
  not_started: { label: 'Not started', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
}

const GPS: Record<GpsState, Shown> = {
  unknown: { label: 'Unknown', tone: 'neutral' },
  not_checked: { label: 'Not checked', tone: 'neutral' },
  granted: { label: 'Permission granted', tone: 'info' },
  denied: { label: 'Permission denied', tone: 'danger' },
}

const SOS: Record<SosStatus, Shown> = {
  not_configured: { label: 'Not configured yet', tone: 'neutral' },
  guardian_missing: { label: 'Guardian not set', tone: 'warning' },
  guardian_set: { label: 'Guardian set', tone: 'success' },
}

interface StatusCardProps {
  icon: LucideIcon
  title: string
  shown: Shown
  detail: string
  to: string
  linkText: string
}

function StatusCard({ icon: Icon, title, shown, detail, to, linkText }: StatusCardProps) {
  return (
    <Card as="article" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="text-base font-bold text-ink">{title}</h3>
      </div>
      <div>
        <Badge tone={shown.tone}>{shown.label}</Badge>
      </div>
      <p className="text-sm text-muted">{detail}</p>
      <Link
        to={to}
        className="mt-auto flex min-h-[var(--control-h)] items-center text-base font-bold text-primary underline underline-offset-4"
      >
        {linkText}
      </Link>
    </Card>
  )
}

function RecentList({
  title,
  icon: Icon,
  items,
  emptyTitle,
  emptyHint,
  to,
  linkText,
}: {
  title: string
  icon: LucideIcon
  items: ActivityItem[]
  emptyTitle: string
  emptyHint: string
  to: string
  linkText: string
}) {
  return (
    <Card as="section" aria-label={title}>
      <CardHeader title={title} headingLevel={3} icon={<Icon className="h-5 w-5" aria-hidden="true" />} />
      {items.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyHint}
          action={
            <Link to={to} className={buttonClasses('secondary')}>
              {linkText}
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.id} className="py-3">
              <p className="font-semibold text-ink">{i.title}</p>
              {i.detail && <p className="text-sm text-muted">{i.detail}</p>}
              <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                <time dateTime={i.at}>{new Date(i.at).toLocaleString()}</time>
                <Badge tone={i.source === 'simulation' ? 'simulation' : i.source === 'hardware' ? 'hardware' : 'live'}>
                  {i.source === 'simulation' ? 'Simulation' : i.source === 'hardware' ? 'Hardware' : 'Live'}
                </Badge>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const SHORTCUTS: Array<{ to: string; label: string; hint: string; icon: LucideIcon }> = [
  { to: '/ai', label: 'AI Assistance', hint: 'Detect obstacles with a camera or image', icon: Bot },
  { to: '/navigation', label: 'Navigation', hint: 'Find a route in Coimbatore', icon: Navigation },
  { to: '/rides', label: 'Book a Ride', hint: 'Request a demo ride', icon: Car },
  { to: '/devices', label: 'Device Management', hint: 'Check and configure hardware', icon: Cpu },
  { to: '/history', label: 'Activity History', hint: 'Review past events', icon: CalendarClock },
  { to: '/sos', label: 'Emergency SOS', hint: 'Alert your guardian', icon: ShieldAlert },
]

export function Dashboard() {
  const { user } = useAuth()
  const { mode } = useMode()
  const data = useDashboardData()
  const gps = useGpsPermission()
  const voiceSupported = isSpeechRecognitionSupported()
  const simulated = mode === 'simulation'
  const firstName = user?.name.trim().split(/\s+/)[0] ?? ''

  return (
    <div className="space-y-8">
      <Card as="section" aria-labelledby="welcome" className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="welcome" className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            Welcome, {firstName || 'there'}
          </h1>
          <p className="mt-2 max-w-xl text-base text-muted">
            {simulated
              ? 'You are in Simulation Mode. Everything you try here uses simulated data and is labelled that way.'
              : 'You are in Live Camera Mode. Only real camera results and real device states are shown.'}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm font-semibold text-muted">Operating mode</span>
          <Badge tone={simulated ? 'simulation' : 'live'} className="uppercase tracking-wide">
            {simulated ? 'Simulation mode' : 'Live mode'}
          </Badge>
          <Link to="/portal" className={buttonClasses('secondary')}>
            Switch portal
          </Link>
        </div>
      </Card>

      <section aria-labelledby="status-heading">
        <h2 id="status-heading" className="text-xl font-bold text-ink">
          System status
        </h2>
        <p className="mt-1 text-base text-muted">
          What Third Eye can actually confirm right now. A device only shows Connected when it has reported in itself.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatusCard
            icon={Bot}
            title="AI assistance"
            shown={DEVICE[data.aiAssistance]}
            detail="No analysis has been run in this session."
            to="/ai"
            linkText="Open AI Assistance"
          />
          <StatusCard
            icon={Camera}
            title="Camera"
            shown={DEVICE[data.devices.camera]}
            detail="Laptop or USB webcam. Starts when you open AI Assistance and allow camera access."
            to="/ai"
            linkText="Start the camera"
          />
          <StatusCard
            icon={Radar}
            title="Distance sensor (VL53L0X)"
            shown={DEVICE[data.devices.distanceSensor]}
            detail={
              simulated
                ? 'No hardware sensor detected. Simulated readings never change this status.'
                : 'No hardware sensor has reported in.'
            }
            to="/devices"
            linkText="Manage devices"
          />
          <StatusCard
            icon={Video}
            title="ESP32-CAM"
            shown={DEVICE[data.devices.esp32Cam]}
            detail="Separate from the laptop camera. Integration is not available yet."
            to="/devices"
            linkText="Manage devices"
          />
          <StatusCard
            icon={Vibrate}
            title="Vibration motor"
            shown={DEVICE[data.devices.vibrationMotor]}
            detail="Hardware integration is not available yet."
            to="/devices"
            linkText="Manage devices"
          />
          <StatusCard
            icon={Battery}
            title="Battery monitoring"
            shown={DEVICE[data.devices.battery]}
            detail="Hardware integration is not available yet, so no battery level is shown."
            to="/devices"
            linkText="Manage devices"
          />
          <StatusCard
            icon={MapPin}
            title="GPS"
            shown={GPS[gps]}
            detail={
              gps === 'granted'
                ? 'Your browser allows location access. A position is read only when you use Navigation.'
                : gps === 'denied'
                  ? 'Location access is blocked in your browser settings. Navigation will need it.'
                  : gps === 'unknown'
                    ? 'Your browser does not report location permission.'
                    : 'Location permission has not been requested yet.'
            }
            to="/navigation"
            linkText="Open Navigation"
          />
          <StatusCard
            icon={Mic}
            title="Voice assistant"
            shown={voiceSupported ? { label: 'Available', tone: 'info' } : { label: 'Unsupported', tone: 'warning' }}
            detail={
              voiceSupported
                ? 'Your browser supports speech recognition. Voice commands arrive in a later release.'
                : 'This browser has no speech recognition. Chrome or Edge are recommended.'
            }
            to="/settings"
            linkText="Voice settings"
          />
          <StatusCard
            icon={ShieldAlert}
            title="Emergency SOS"
            shown={SOS[data.sos]}
            detail="Add a guardian in your profile so SOS alerts have someone to reach."
            to="/sos"
            linkText="Open Emergency SOS"
          />
        </div>
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="text-xl font-bold text-ink">
          Recent activity
        </h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <RecentList
            title="Obstacle detections"
            icon={Radar}
            items={data.recent.obstacles}
            emptyTitle="No detections yet"
            emptyHint="Detections appear here after you analyse the camera or an image."
            to="/ai"
            linkText="Open AI Assistance"
          />
          <RecentList
            title="Navigation sessions"
            icon={Navigation}
            items={data.recent.navigation}
            emptyTitle="No navigation sessions yet"
            emptyHint="Routes you start will be listed here."
            to="/navigation"
            linkText="Plan a route"
          />
          <RecentList
            title="Ride requests"
            icon={Car}
            items={data.recent.rides}
            emptyTitle="No ride requests yet"
            emptyHint="Demo ride requests will be listed here."
            to="/rides"
            linkText="Book a ride"
          />
          <RecentList
            title="Emergency activity"
            icon={ShieldAlert}
            items={data.recent.emergencies}
            emptyTitle="No emergency activity"
            emptyHint="SOS alerts and their delivery results will be listed here."
            to="/sos"
            linkText="Review SOS"
          />
        </div>
      </section>

      <section aria-labelledby="quick-heading">
        <h2 id="quick-heading" className="text-xl font-bold text-ink">
          Quick access
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SHORTCUTS.map(({ to, label, hint, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="bw flex min-h-[var(--control-h)] items-center gap-4 rounded-2xl border-line bg-surface p-4 shadow-card transition-colors hover:border-primary"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block font-bold text-ink">{label}</span>
                  <span className="block text-sm text-muted">{hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
