import { Menu, ShieldAlert } from 'lucide-react'
import type { Ref } from 'react'
import { Link } from 'react-router-dom'
import { VoiceButton } from '../features/voice/VoiceButton'
import { NotificationBell } from '../features/notifications/NotificationBell'
import { ModeBadge } from './ModeBadge'
import { UserMenu } from './UserMenu'

interface TopbarProps {
  menuButtonRef?: Ref<HTMLButtonElement>
  onOpenMobileNav: () => void
  mobileNavOpen: boolean
}

export function Topbar({ onOpenMobileNav, mobileNavOpen, menuButtonRef }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-2 gap-y-2 border-b-[length:var(--border-w)] border-line bg-surface px-3 py-2 sm:gap-3 sm:px-6">
      <button
        ref={menuButtonRef}
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
          className="flex h-[var(--control-h)] items-center gap-2 rounded-xl bg-danger px-3 text-base font-bold text-white hover:brightness-90 sm:px-4"
        >
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Emergency SOS</span>
        </Link>
        <UserMenu />
      </div>
    </header>
  )
}
