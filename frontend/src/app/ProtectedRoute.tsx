import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '../design'
import { useAuth } from '../lib/auth'
import { useMode } from '../lib/mode'

interface ProtectedRouteProps {
  /** When true, signed-in users who have not chosen a portal are sent to /portal first. */
  requireMode?: boolean
}

export function ProtectedRoute({ requireMode = false }: ProtectedRouteProps) {
  const { status } = useAuth()
  const { mode } = useMode()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner size="lg" label="Checking your session" />
      </div>
    )
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (requireMode && !mode) {
    return <Navigate to="/portal" replace />
  }
  return <Outlet />
}

/** Login/Register/Forgot-password make no sense once signed in. */
export function PublicOnlyRoute() {
  const { status } = useAuth()
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner size="lg" label="Checking your session" />
      </div>
    )
  }
  if (status === 'authenticated') return <Navigate to="/portal" replace />
  return <Outlet />
}
