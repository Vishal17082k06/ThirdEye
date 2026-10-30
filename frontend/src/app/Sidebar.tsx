import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '../lib/cn'
import { Brand } from './Logo'
import { NAV_ITEMS } from './nav'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
}

/**
 * Below 1024px the sidebar is an off-canvas drawer (opened from the Topbar).
 * From 1024px up it is a static column that can collapse to an icon rail.
 */
export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={onCloseMobile} aria-hidden="true" />
      )}
      <aside
        id="app-sidebar"
        data-collapsed={collapsed}
        data-open={mobileOpen}
        className={cn(
          'group/side fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r-[length:var(--border-w)] border-line bg-surface transition-transform duration-200',
          'invisible -translate-x-full data-[open=true]:visible data-[open=true]:translate-x-0',
          'lg:visible lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shrink-0 lg:data-[collapsed=true]:w-20',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
          <Brand textClassName="lg:group-data-[collapsed=true]/side:sr-only" />
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-muted lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="space-y-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  title={collapsed ? label : undefined}
                  onClick={onCloseMobile}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-[var(--control-h)] items-center gap-3 rounded-xl px-3 py-2 text-base font-semibold transition-colors',
                      'lg:group-data-[collapsed=true]/side:justify-center lg:group-data-[collapsed=true]/side:px-0',
                      isActive ? 'bg-primary text-on-primary' : 'text-ink hover:bg-surface-muted',
                    )
                  }
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="lg:group-data-[collapsed=true]/side:sr-only">{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden shrink-0 border-t border-line p-3 lg:block">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex min-h-[var(--control-h)] w-full items-center gap-3 rounded-xl px-3 text-base font-semibold text-muted hover:bg-surface-muted hover:text-ink lg:group-data-[collapsed=true]/side:justify-center lg:group-data-[collapsed=true]/side:px-0"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
            )}
            <span aria-hidden="true" className="lg:group-data-[collapsed=true]/side:sr-only">
              Collapse
            </span>
          </button>
        </div>
      </aside>
    </>
  )
}
