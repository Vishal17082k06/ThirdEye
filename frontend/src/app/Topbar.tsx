import { Bell, Menu, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Popover } from '../design'
import { VoiceButton } from '../features/voice/VoiceButton'
import { useUnreadCount } from '../hooks/useUnreadCount'
import { ModeBadge } from './ModeBadge'
import { UserMenu } from './UserMenu'

interface TopbarProps {
  onOpenMobileNav: () => void
  mobileNavOpen: boolean
}

function NotificationBell() {
  const unread = useUnreadCount()
  return (
    <Popover
      label="Notifications"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'}
          className="bw relative flex h-[var(--control-h)] w-[var(--control-h)] items-center justify-center rounded-xl border-line-strong bg-surface text-ink hover:bg-surface-muted"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {() => (
        <div>
          <p className="font-bold text-ink">Notifications</p>
          <p className="mt-1 text-sm text-muted">
            {unread > 0 ? `${unread} unread.` : 'You have no notifications.'} Alerts about devices, SOS and rides will
            appear here.
          </p>
        </div>
      )}
    </Popover>
  )
}

export function Topbar({ onOpenMobileNav, mobileNavOpen }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-2 gap-y-2 border-b-[length:var(--border-w)] border-line bg-surface px-3 py-2 sm:gap-3 sm:px-6">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation menu"
        aria-expanded={mobileNavOpen}
        aria-controls="app-sidebar"
        className="bw flex h-[var(--control-h)] w-[var(--control-h)] shrink-0 items-center justify-center rounded-xl border-line-strong bg-surface hover:bg-surface-muted lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-0">
        <ModeBadge />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <VoiceButton />
        <NotificationBell />
        <Link
          to="/sos"
          aria-label="Emergency SOS"
          className="flex h-[var(--control-h)] items-center gap-2 rounded-xl bg-danger px-3 text-base font-bold text-white hover:brightness-90 sm:px-4"
        >
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline" aria-hidden="true">SOS</span>
        </Link>
        <UserMenu />
      </div>
    </header>
  )
}
