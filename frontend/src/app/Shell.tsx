import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useEscapeLayer } from '../lib/escapeStack'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const COLLAPSE_KEY = 'thirdeye.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function Shell() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const lastPath = useRef(location.pathname)
  const pathWhenOpened = useRef(location.pathname)
  const wasOpen = useRef(false)

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        /* preference just won't persist */
      }
      return !c
    })
  }

  // The drawer is a modal layer on small screens: Esc closes it (only when it is the topmost layer).
  useEscapeLayer(mobileOpen, () => setMobileOpen(false))

  // After a route change (not the first render, which would bypass the skip link),
  // move focus to the page so keyboard and screen-reader users start at the top of it.
  useEffect(() => {
    if (lastPath.current === location.pathname) return
    lastPath.current = location.pathname
    mainRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  // Drawer focus management: move focus in on open, give it back to the menu button on close.
  useEffect(() => {
    if (mobileOpen) {
      pathWhenOpened.current = lastPath.current
      document.querySelector<HTMLElement>('#app-sidebar nav a')?.focus()
    } else if (wasOpen.current && pathWhenOpened.current === lastPath.current) {
      // If a link was followed, the route-change effect below owns focus instead.
      menuButtonRef.current?.focus()
    }
    wasOpen.current = mobileOpen
  }, [mobileOpen])

  // If the window grows past the drawer breakpoint while it is open, close it so the page is not left inert.
  useEffect(() => {
    if (!mobileOpen || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => mq.matches && setMobileOpen(false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mobileOpen])

  return (
    <div className="flex min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only z-[70] rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      {/* inert while the drawer is open: focus cannot escape behind it and assistive tech ignores the page. */}
      <div className="flex min-w-0 flex-1 flex-col" inert={mobileOpen}>
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} mobileNavOpen={mobileOpen} menuButtonRef={menuButtonRef} />
        <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
