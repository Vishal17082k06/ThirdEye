import { Camera, FlaskConical, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brand } from '../../app/Logo'
import { Badge, Button } from '../../design'
import { useAuth } from '../../lib/auth'
import { useMode, type Mode } from '../../lib/mode'

interface PortalCardProps {
  mode: Mode
  icon: ReactNode
  title: string
  summary: string
  features: string[]
  honesty: string
  buttonLabel: string
  badge: ReactNode
  onChoose: (mode: Mode) => void
}

function PortalCard({ mode, icon, title, summary, features, honesty, buttonLabel, badge, onChoose }: PortalCardProps) {
  const headingId = `portal-${mode}`
  return (
    <section
      aria-labelledby={headingId}
      className="bw flex flex-col rounded-2xl border-line bg-surface p-6 shadow-card sm:p-8"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">{icon}</span>
        {badge}
      </div>
      <h2 id={headingId} className="mt-5 text-2xl font-extrabold tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-2 text-base text-muted">{summary}</p>
      <ul className="mt-5 space-y-2 text-base text-ink">
        {features.map((f) => (
          <li key={f} className="flex gap-3">
            <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            {f}
          </li>
        ))}
      </ul>
      <p className="bw mt-6 rounded-xl border-line bg-surface-muted p-4 text-sm text-ink">
        <span className="font-bold">Good to know: </span>
        {honesty}
      </p>
      <div className="mt-auto pt-6">
        <Button fullWidth onClick={() => onChoose(mode)}>
          {buttonLabel}
        </Button>
      </div>
    </section>
  )
}

export function PortalSelect() {
  const { user, logout } = useAuth()
  const { setMode } = useMode()
  const navigate = useNavigate()

  function choose(mode: Mode) {
    setMode(mode)
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Brand />
        <Button
          variant="ghost"
          onClick={() => {
            logout()
            navigate('/login', { replace: true })
          }}
          leftIcon={<LogOut className="h-5 w-5" aria-hidden="true" />}
        >
          Log out
        </Button>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 pb-12 pt-4 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          {user ? `Welcome, ${user.name.split(' ')[0]}.` : 'Welcome.'} How do you want to use Third Eye?
        </h1>
        <p className="mt-3 max-w-2xl text-base text-muted">
          Pick a portal. You can switch later from the dashboard. Your choice is always shown at the top of every page.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <PortalCard
            mode="simulation"
            icon={<FlaskConical className="h-7 w-7" aria-hidden="true" />}
            title="Simulation Mode"
            summary="Explore every feature without any hardware. Ideal for learning, demos and testing."
            features={[
              'Simulated distance sensor readings and obstacle scenarios',
              'Upload images for AI analysis',
              'Try voice announcements, navigation and a safe SOS dry run',
            ]}
            honesty="Everything here is simulated and labelled SIMULATION. It is never shown as a reading from real hardware."
            buttonLabel="Start Simulation Mode"
            badge={<Badge tone="simulation">No hardware needed</Badge>}
            onChoose={choose}
          />
          <PortalCard
            mode="live"
            icon={<Camera className="h-7 w-7" aria-hidden="true" />}
            title="Live Camera Mode"
            summary="Use your laptop or USB webcam to analyse what is in front of you in real time."
            features={[
              'Choose a camera, start and stop it, and capture images',
              'Camera frames are analysed for real detections',
              'Camera and ESP32-CAM connection status are tracked separately',
            ]}
            honesty="Your browser will ask for camera permission. Devices that are not connected stay marked as not connected: no placeholder readings."
            buttonLabel="Start Live Camera Mode"
            badge={<Badge tone="live">Uses your camera</Badge>}
            onChoose={choose}
          />
        </div>
      </main>
    </div>
  )
}
