import { Loader2, Navigation as NavigationIcon, Square, TriangleAlert } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Button, buttonClasses } from '../../design'
import { formatDistance } from '../../lib/geo'
import { useNavigationActions, useNavigationSummary } from './navigationContext'

/**
 * Shown on every page except Navigation: while a trip is running, while one that was asked for (for example by voice)
 * is still waiting for GPS or a route, and when such a request gave up. A trip is never invisible or unstoppable.
 */
export function NavigationBar() {
  const s = useNavigationSummary()
  const actions = useNavigationActions()
  const { pathname } = useLocation()
  if (pathname.startsWith('/navigation')) return null

  if (s.failure) {
    return (
      <div role="alert" className="bw border-danger bg-danger-soft px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 font-semibold text-danger">
            <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{s.failure}</span>
          </p>
          <div className="flex gap-2">
            <Link to="/navigation" className={buttonClasses('secondary')}>
              Open
            </Link>
            <Button variant="secondary" onClick={actions.dismissStartFailure}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!s.tripActive && !s.pendingMessage) return null
  return (
    <div role="region" aria-label="Navigation in progress" className="bw border-primary bg-primary-soft px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 font-semibold text-ink">
          {s.tripActive ? (
            <NavigationIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
          )}
          <span className="truncate">
            {s.tripActive ? (
              <>
                Navigation in progress — {s.destinationLabel ?? 'destination'}
                {s.remainingM != null ? ` · ${formatDistance(s.remainingM)} left` : ''}
                {s.simulation ? ' · SIMULATED' : ''}
              </>
            ) : (
              <>
                Navigation to {s.destinationLabel ?? 'destination'} has not started — {s.pendingMessage}
              </>
            )}
          </span>
        </p>
        <div className="flex gap-2">
          <Link to="/navigation" className={buttonClasses('secondary')}>
            Open
          </Link>
          <Button variant="danger" onClick={actions.stopNavigation} leftIcon={<Square className="h-5 w-5" aria-hidden="true" />}>
            Stop
          </Button>
        </div>
      </div>
    </div>
  )
}
