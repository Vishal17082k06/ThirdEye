import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { Dashboard } from './Dashboard'

afterEach(() => vi.unstubAllGlobals())

const card = (name: RegExp | string) => screen.getByRole('heading', { name }).closest('article') as HTMLElement

/** A fetch that never resolves: everything stays pending. */
function hang() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
}

describe('Dashboard honesty while loading and on failure', () => {
  it('shows Checking while devices and guardian are pending, never a guessed status', async () => {
    hang()
    renderApp(<Dashboard />)
    for (const name of [/^Camera$/, /Distance sensor/, /^ESP32-CAM$/, /Vibration motor/, /Battery monitoring/, /Emergency SOS/]) {
      const c = card(name)
      expect(within(c).getByText('Checking…')).toBeInTheDocument()
      expect(c).toHaveAttribute('aria-busy', 'true')
    }
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument()
    expect(screen.queryByText('Not integrated')).not.toBeInTheDocument()
    expect(screen.queryByText('Guardian not set')).not.toBeInTheDocument()
  })

  it('shows Unknown when the devices and guardian requests fail', async () => {
    mockApi({ 'GET /devices': fail(500, 'boom'), 'GET /guardian': fail(500, 'boom'), 'GET /events': { items: [], total: 0, limit: 5, offset: 0 } })
    renderApp(<Dashboard />)
    await vi.waitFor(() => expect(within(card(/Distance sensor/)).getByText('Unknown')).toBeInTheDocument())
    expect(within(card(/^Camera$/)).getByText('Unknown')).toBeInTheDocument()
    expect(within(card(/Emergency SOS/)).getByText('Unknown')).toBeInTheDocument()
    expect(card(/Distance sensor/)).not.toHaveAttribute('aria-busy', 'true')
  })

  it('camera card points to Device Management Check camera, not AI Assistance', async () => {
    hang()
    renderApp(<Dashboard />)
    const c = card(/^Camera$/)
    expect(within(c).getByText(/Use Check camera in Device Management/)).toBeInTheDocument()
    expect(within(c).getByRole('link')).toHaveAttribute('href', '/devices')
    expect(c).not.toHaveTextContent(/Starts when you open AI Assistance/)
  })
})
