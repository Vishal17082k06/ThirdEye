import { Eye, Mic, Navigation, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Brand } from '../../app/Logo'

const points = [
  { icon: Eye, text: 'Obstacle detection from your camera, announced aloud' },
  { icon: Navigation, text: 'Walking, cycling and driving routes around Coimbatore' },
  { icon: ShieldCheck, text: 'Emergency SOS that alerts your guardian' },
  { icon: Mic, text: 'Built for keyboard, touch and screen-reader use' },
]

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}

/** Shared frame for Login, Register and Forgot password: a calm brand panel beside a focused form card. */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden bg-primary-soft px-12 py-12 lg:flex lg:flex-col lg:justify-between">
        <Brand />
        <div className="max-w-md">
          <p className="text-3xl font-extrabold leading-tight tracking-tight text-ink">
            See the path ahead with confidence.
          </p>
          <p className="mt-3 text-base text-muted">
            Third Eye is an assistance system for people with visual impairment: it describes surroundings, helps you
            get around, and calls for help when you need it.
          </p>
          <ul className="mt-8 space-y-4">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-base text-ink">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-primary shadow-card">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="pt-2">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted">Third Eye never shows simulated data as real hardware readings.</p>
      </aside>

      <main id="main" className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 text-base text-muted">{subtitle}</p>
          <div className="bw mt-6 rounded-2xl border-line bg-surface p-5 shadow-card sm:p-7">{children}</div>
          {footer && <div className="mt-6 text-center text-base text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
