import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { Dashboard } from '../features/dashboard/Dashboard'
import { PortalSelect } from '../features/portal/PortalSelect'
import { renderApp } from '../test-utils'
import { ProtectedRoute } from './ProtectedRoute'

beforeEach(() => sessionStorage.clear())

describe('ProtectedRoute', () => {
  const tree = (
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route element={<ProtectedRoute />}>
        <Route path="/secret" element={<p>secret page</p>} />
      </Route>
    </Routes>
  )

  it('redirects unauthenticated users to /login', () => {
    renderApp(tree, { route: '/secret', user: null })
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(screen.queryByText('secret page')).not.toBeInTheDocument()
  })

  it('lets authenticated users through', () => {
    renderApp(tree, { route: '/secret' })
    expect(screen.getByText('secret page')).toBeInTheDocument()
  })

  it('sends signed-in users without a portal choice to /portal when a mode is required', () => {
    renderApp(
      <Routes>
        <Route path="/portal" element={<p>portal page</p>} />
        <Route element={<ProtectedRoute requireMode />}>
          <Route path="/dashboard" element={<p>dash</p>} />
        </Route>
      </Routes>,
      { route: '/dashboard', mode: null },
    )
    expect(screen.getByText('portal page')).toBeInTheDocument()
  })
})

describe('PortalSelect', () => {
  it('choosing Simulation Mode stores the mode and goes to the dashboard', async () => {
    renderApp(
      <Routes>
        <Route path="/portal" element={<PortalSelect />} />
        <Route path="/dashboard" element={<p>dashboard page</p>} />
      </Routes>,
      { route: '/portal' },
    )
    expect(screen.getByRole('heading', { name: 'Simulation Mode' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Live Camera Mode' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /start simulation mode/i }))
    expect(screen.getByText('dashboard page')).toBeInTheDocument()
    expect(sessionStorage.getItem('thirdeye.mode')).toBe('simulation')
  })

  it('choosing Live Camera Mode stores live', async () => {
    renderApp(
      <Routes>
        <Route path="/portal" element={<PortalSelect />} />
        <Route path="/dashboard" element={<p>dashboard page</p>} />
      </Routes>,
      { route: '/portal' },
    )
    await userEvent.click(screen.getByRole('button', { name: /start live camera mode/i }))
    expect(sessionStorage.getItem('thirdeye.mode')).toBe('live')
  })
})

describe('Dashboard', () => {
  it('shows honest statuses for every item and never a connected device', () => {
    renderApp(<Dashboard />, { mode: 'simulation' })
    expect(screen.getByText('Welcome, Asha')).toBeInTheDocument()
    expect(screen.getByText('Disconnected')).toBeInTheDocument() // VL53L0X
    expect(screen.getAllByText('Not integrated')).toHaveLength(3) // ESP32-CAM, vibration, battery
    expect(screen.getAllByText('Not started')).toHaveLength(2) // AI assistance, camera
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    for (const name of [
      'AI assistance',
      'Camera',
      'Distance sensor (VL53L0X)',
      'ESP32-CAM',
      'Vibration motor',
      'Battery monitoring',
      'GPS',
      'Voice assistant',
      'Emergency SOS',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    expect(screen.getByText('No detections yet')).toBeInTheDocument()
  })
})
