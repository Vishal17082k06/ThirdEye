import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test-utils'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

function SidebarHarness() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} mobileOpen={false} onCloseMobile={() => {}} />
  )
}

describe('Sidebar', () => {
  it('renders the 9 links in the spec order', () => {
    renderApp(<SidebarHarness />, { route: '/dashboard' })
    const links = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Dashboard',
      'AI Assistance',
      'Navigation',
      'Book a Ride',
      'Device Management',
      'Activity History',
      'Emergency SOS',
      'Profile',
      'Settings',
    ])
  })

  it('marks the current page with aria-current', () => {
    renderApp(<SidebarHarness />, { route: '/devices' })
    expect(screen.getByRole('link', { name: 'Device Management' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('collapse toggle updates aria-expanded', async () => {
    renderApp(<SidebarHarness />)
    const toggle = screen.getByRole('button', { name: /collapse sidebar/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: /collapse sidebar/i })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('Topbar', () => {
  it('shows SIMULATION MODE in simulation mode', () => {
    renderApp(<Topbar onOpenMobileNav={() => {}} mobileNavOpen={false} />, { mode: 'simulation' })
    expect(screen.getByText(/simulation mode/i)).toBeInTheDocument()
    expect(screen.queryByText(/live mode/i)).not.toBeInTheDocument()
  })

  it('shows LIVE MODE in live mode', () => {
    renderApp(<Topbar onOpenMobileNav={() => {}} mobileNavOpen={false} />, { mode: 'live' })
    expect(screen.getByText(/live mode/i)).toBeInTheDocument()
  })

  it('has SOS link, voice button, bell and an account menu with Profile, Settings and Log out', async () => {
    renderApp(<Topbar onOpenMobileNav={() => {}} mobileNavOpen={false} />, { mode: 'simulation' })
    expect(screen.getByRole('link', { name: 'Emergency SOS' })).toHaveAttribute('href', '/sos')
    expect(screen.getByRole('button', { name: 'Voice assistant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }))
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument()
  })

  it('voice button opens a panel saying voice arrives later', async () => {
    renderApp(<Topbar onOpenMobileNav={() => {}} mobileNavOpen={false} />, { mode: 'live' })
    await userEvent.click(screen.getByRole('button', { name: 'Voice assistant' }))
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument()
  })
})
