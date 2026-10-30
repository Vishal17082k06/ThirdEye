import { ChevronDown, LogOut, Settings, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Modal, Popover } from '../design'
import { useAuth } from '../lib/auth'
import { useMode } from '../lib/mode'

const itemClasses =
  'flex min-h-[var(--control-h)] w-full items-center gap-3 rounded-xl px-3 text-base font-semibold text-ink hover:bg-surface-muted'

export function UserMenu() {
  const { user, logout } = useAuth()
  const { setMode } = useMode()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const initial = (user?.name.trim()[0] ?? '?').toUpperCase()

  function doLogout() {
    setConfirming(false)
    logout()
    setMode(null)
    navigate('/login', { replace: true })
  }

  return (
    <>
      <Popover
        label="Account menu"
        trigger={(props) => (
          <button
            type="button"
            {...props}
            aria-label={`Account menu for ${user?.name ?? 'user'}`}
            className="bw flex h-[var(--control-h)] items-center gap-2 rounded-xl border-line-strong bg-surface pl-1.5 pr-2 hover:bg-surface-muted"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-on-primary">
              {initial}
            </span>
            <ChevronDown className="h-4 w-4 text-muted" aria-hidden="true" />
          </button>
        )}
      >
        {(close) => (
          <div>
            <div className="mb-2 border-b border-line px-3 pb-3">
              <p className="truncate font-bold text-ink">{user?.name}</p>
              <p className="truncate text-sm text-muted">{user?.email}</p>
            </div>
            <Link to="/profile" onClick={close} className={itemClasses}>
              <UserRound className="h-5 w-5" aria-hidden="true" /> Profile
            </Link>
            <Link to="/settings" onClick={close} className={itemClasses}>
              <Settings className="h-5 w-5" aria-hidden="true" /> Settings
            </Link>
            <button
              type="button"
              className={itemClasses}
              onClick={() => {
                close()
                setConfirming(true)
              }}
            >
              <LogOut className="h-5 w-5" aria-hidden="true" /> Log out
            </button>
          </div>
        )}
      </Popover>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Log out of Third Eye?"
        description="You will need to sign in again to use the dashboard. Your portal choice for this session will be cleared."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Stay signed in
            </Button>
            <Button variant="danger" onClick={doLogout}>
              Log out
            </Button>
          </>
        }
      />
    </>
  )
}
