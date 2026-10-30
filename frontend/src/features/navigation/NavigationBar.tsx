import { Navigation as NavigationIcon, Square } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Button, buttonClasses } from '../../design'
import { formatDistance } from '../../lib/geo'
import { navigationController } from './controller'
import { useNavigationState } from './navigationContext'

/** Shown on every page except Navigation while a trip is running, so a trip is never forgotten or unstoppable. */
export function NavigationBar() {
  const nav = useNavigationState()
  const { pathname } = useLocation()
  if (!nav.tripActive || pathname.startsWith('/navigation')) return null
  const remaining = nav.progress?.remainingM ?? nav.route?.distance_m
  return (
    <div
      role="region"
      aria-label="Navigation in progress"
      className="bw border-primary bg-primary-soft px-4 py-3 sm:px-6"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 font-semibold text-ink">
          <NavigationIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">
            Navigation in progress — {nav.destination?.label ?? 'destination'}
            {remaining != null ? ` · ${formatDistance(remaining)} left` : ''}
            {nav.simulation ? ' · SIMULATED' : ''}
          </span>
        </p>
        <div className="flex gap-2">
          <Link to="/navigation" className={buttonClasses('secondary')}>
            Open
          </Link>
          <Button variant="danger" onClick={() => navigationController.stop()} leftIcon={<Square className="h-5 w-5" aria-hidden="true" />}>
            Stop
          </Button>
        </div>
      </div>
    </div>
  )
}
