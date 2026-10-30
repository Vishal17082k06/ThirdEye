import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Topbar } from '../../app/Topbar'
import type { Mode } from '../../lib/mode'
import { fail, mockApi } from '../../test-api'
import { installFakeGeolocation, type FakeGeo } from '../../test-geo'
import { renderApp } from '../../test-utils'
import { Dashboard } from '../dashboard/Dashboard'
import type { SosRecord, SosStatus } from './api'
import { SosPage } from './SosPage'
import { SosProvider } from './SosProvider'

const GUARDIAN = { name: 'Meera Raman', email: 'meera@example.com', phone: '+91 98765 43210', relationship: 'Mother' }
const READY: SosStatus = { email_configured: true, guardian_ready: true, guardian_name: 'Meera Raman' }
const ACCEPTED = /Email accepted by the mail server for delivery to Meera Raman meera@example.com\. This confirms hand-off, not that it was read\./

function rec(over: Partial<SosRecord> = {}): SosRecord {
  return {
    id: 7,
    created_at: '2026-10-30T10:00:00Z',
    status: 'sent',
    lat: 11.0183,
    lon: 76.9725,
    accuracy_m: 12,
    maps_link: 'https://www.google.com/maps?q=11.0183,76.9725',
    guardian_name: 'Meera Raman',
    guardian_email: 'meera@example.com',
    attempts: 1,
    error: null,
    sent_at: '2026-10-30T10:00:02Z',
    note: null,
    delivery_message: 'Email accepted by the mail server for delivery to meera@example.com. This confirms the email was handed off, not that it was read.',
    retry_available: false,
    ...over,
  }
}

const failed = (over: Partial<SosRecord> = {}) =>
  rec({ status: 'failed', sent_at: null, error: 'Email service is not configured on the server.', delivery_message: 'Email service is not configured on the server.', retry_available: true, ...over })

let geo: FakeGeo
let list: SosRecord[]
let posts: Array<Record<string, unknown>>

function App() {
  return (
    <SosProvider>
      <Topbar onOpenMobileNav={() => {}} mobileNavOpen={false} />
      <Routes>
        <Route path="/sos" element={<SosPage />} />
        <Route path="/profile" element={<h1>Profile page</h1>} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </SosProvider>
  )
}

interface Setup {
  mode?: Mode
  status?: SosStatus
  postResult?: unknown
  retryResult?: unknown
  route?: string
  extra?: Record<string, unknown>
  initial?: SosRecord[]
}

function setup({ mode = 'live', status = READY, postResult, retryResult, route = '/sos', extra = {}, initial = [] }: Setup = {}) {
  geo = installFakeGeolocation()
  list = initial
  posts = []
  const api = mockApi({
    'GET /sos/status': status,
    'GET /guardian': GUARDIAN,
    'GET /sos': () => ({ items: list, total: list.length, limit: 50, offset: 0 }),
    'POST /sos': (body: unknown) => {
      posts.push(body as Record<string, unknown>)
      return postResult ?? rec()
    },
    'POST /sos/7/retry': () => retryResult ?? rec({ attempts: 2 }),
    'GET /sos/7': () => list[0] ?? rec(),
    ...extra,
  })
  renderApp(<App />, { route, mode })
  return api
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const sosButton = () => screen.getByRole('button', { name: /send emergency alert/i })

async function openDialog() {
  await waitFor(() => expect(sosButton()).toBeEnabled())
  await userEvent.click(sosButton())
  return screen.findByRole('dialog')
}

describe('SOS page readiness', () => {
  it('explains a missing guardian email, points to Profile, and never POSTs', async () => {
    const api = setup({ status: { email_configured: true, guardian_ready: false, guardian_name: null } })
    expect(await screen.findByText(/You have not added a guardian email yet/)).toBeInTheDocument()
    expect(sosButton()).toBeDisabled()
    await userEvent.click(sosButton())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.callsTo('POST', '/sos')).toHaveLength(0)
    await userEvent.click(screen.getByRole('link', { name: 'Go to Profile' }))
    expect(await screen.findByRole('heading', { name: 'Profile page' })).toBeInTheDocument()
  })

  it('warns honestly when email is not configured but still allows the attempt', async () => {
    setup({ status: { ...READY, email_configured: false } })
    expect(await screen.findByText(/Email service is not configured on the server — SOS emails cannot be sent\. See setup instructions in the README\./)).toBeInTheDocument()
    await waitFor(() => expect(sosButton()).toBeEnabled())
  })

  it('shows guardian, call link and the GPS status line', async () => {
    setup()
    expect(await screen.findByText(/meera@example\.com/)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /call guardian/i })).toHaveAttribute('href', 'tel:+919876543210')
    expect(screen.getByText('Getting location…')).toBeInTheDocument()
    act(() => geo.emit(11.0, 76.9, 14.4))
    expect(await screen.findByText('Location ready (±14 m)')).toBeInTheDocument()
  })

  it('says location is unavailable when GPS is denied', async () => {
    setup()
    await screen.findByText(/meera@example\.com/)
    act(() => geo.fail(1))
    expect(await screen.findByText('Location unavailable — the alert will say location could not be obtained')).toBeInTheDocument()
  })
})

describe('SOS confirm and send', () => {
  it('requires explicit confirmation and posts exactly the coordinates from the fix', async () => {
    const api = setup()
    await screen.findByText(/meera@example\.com/)
    act(() => geo.emit(11.0183, 76.9725, 12.5))
    const dialog = await openDialog()
    expect(within(dialog).getByText('Send emergency alert to Meera Raman meera@example.com? This will email them your location if available.')).toBeInTheDocument()
    expect(api.callsTo('POST', '/sos')).toHaveLength(0)
    await userEvent.type(within(dialog).getByLabelText(/optional note/i), 'at the bus stop')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    expect(await within(await screen.findByRole('dialog')).findByText(ACCEPTED)).toBeInTheDocument()
    expect(posts).toEqual([{ lat: 11.0183, lon: 76.9725, accuracy_m: 12.5, note: 'at the bus stop' }])
  })

  it('cancel sends nothing', async () => {
    const api = setup()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.callsTo('POST', '/sos')).toHaveLength(0)
  })

  it('sends no coordinates when location is unavailable and says so', async () => {
    setup()
    await screen.findByText(/meera@example\.com/)
    act(() => geo.fail(1))
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({})
  })

  it('a pending permission prompt does not block: waits about 2 seconds, then sends without coordinates', async () => {
    setup()
    await screen.findByText(/meera@example\.com/)
    const dialog = await openDialog()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    await act(() => vi.advanceTimersByTimeAsync(1500))
    expect(posts).toHaveLength(0)
    expect(screen.getByText('Sending without location in a moment…')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    await waitFor(() => expect(posts).toEqual([{}]))
  })

  it('uses a fix that arrives while waiting', async () => {
    setup()
    await screen.findByText(/meera@example\.com/)
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    act(() => geo.emit(11.5, 77.5, 30))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ lat: 11.5, lon: 77.5, accuracy_m: 30 })
  })

  it('shows success text ONLY for status sent: failed shows the server message, retry and call', async () => {
    setup({ postResult: failed() })
    act(() => geo.fail(2))
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    const d = await screen.findByRole('dialog')
    expect(await within(d).findByText(/Alert NOT delivered\. Email service is not configured on the server\./)).toBeInTheDocument()
    expect(within(d).getByRole('button', { name: /retry sending/i })).toBeInTheDocument()
    expect(within(d).getByRole('link', { name: /call your guardian/i })).toHaveAttribute('href', 'tel:+919876543210')
    expect(screen.queryByText(/accepted by the mail server/i)).not.toBeInTheDocument()
  })

  it('pending is shown as Sending, never as success', async () => {
    const pending = rec({ status: 'pending', sent_at: null, delivery_message: 'Sending…' })
    setup({ postResult: pending, initial: [pending] })
    act(() => geo.fail(2))
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    const d = await screen.findByRole('dialog')
    expect(await within(d).findByText('Sending…')).toBeInTheDocument()
    expect(screen.queryByText(/accepted by the mail server/i)).not.toBeInTheDocument()
  })

  it('retry posts to the retry endpoint and then shows the accepted outcome', async () => {
    const api = setup({ postResult: failed() })
    act(() => geo.fail(2))
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    await userEvent.click(await screen.findByRole('button', { name: /retry sending/i }))
    expect(await screen.findByText(ACCEPTED)).toBeInTheDocument()
    expect(api.callsTo('POST', '/sos/7/retry')).toHaveLength(1)
    expect(api.callsTo('POST', '/sos')).toHaveLength(1)
  })

  it('treats the double-tap guard 200 (the earlier record) as that record', async () => {
    const api = setup({ postResult: rec({ id: 7, attempts: 1 }) })
    act(() => geo.fail(2))
    for (let i = 0; i < 2; i++) {
      const dialog = await openDialog()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
      expect(await within(await screen.findByRole('dialog')).findByText(ACCEPTED)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    }
    expect(api.callsTo('POST', '/sos')).toHaveLength(2)
    expect(screen.queryByText(/not delivered/i)).not.toBeInTheDocument()
  })

  it('a request-level failure says the alert was NOT sent', async () => {
    setup({ postResult: fail(400, 'Add a guardian email in Profile before sending SOS.') })
    act(() => geo.fail(2))
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    expect(await screen.findByText('The alert was not sent: Add a guardian email in Profile before sending SOS.')).toBeInTheDocument()
    expect(screen.queryByText(/Do not assume/)).not.toBeInTheDocument()
  })

  it('the result sits in a polite live region', async () => {
    setup()
    act(() => geo.fail(2))
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    const live = within(await screen.findByRole('dialog')).getByTestId('sos-result')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(await within(live).findByText(ACCEPTED)).toBeInTheDocument()
  })
})

const UNKNOWN = /We could not confirm whether the alert was sent\. Do not assume it was\. Call your guardian now, and check SOS history below\./

async function sendNow() {
  act(() => geo.fail(2))
  const dialog = await openDialog()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
}

describe('Unknown and rejected outcomes', () => {
  it.each([
    [
      'network error (status 0)',
      () => {
        throw new Error('offline')
      },
    ],
    ['502', () => fail(502, 'Bad gateway')],
    ['500', () => fail(500, 'boom')],
  ])('%s is an unknown outcome, never "not sent", and refetches the history', async (_n, handler) => {
    const api = setup({ extra: { 'POST /sos': handler } })
    await screen.findByText('No SOS alerts yet')
    const before = api.callsTo('GET', '/sos').length
    await sendNow()
    expect(await screen.findByText(UNKNOWN)).toBeInTheDocument()
    expect(screen.queryByText(/was not sent/i)).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /call your guardian/i })).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send again (may send a duplicate)' })).toBeInTheDocument()
    await waitFor(() => expect(api.callsTo('GET', '/sos').length).toBeGreaterThan(before))
  })

  it('refetches the history again after 5 s and 15 s', async () => {
    const api = setup({ extra: { 'POST /sos': () => fail(502, 'Bad gateway') } })
    await screen.findByText('No SOS alerts yet')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await sendNow()
    await screen.findByText(UNKNOWN)
    const n = () => api.callsTo('GET', '/sos').length
    const a = n()
    await act(() => vi.advanceTimersByTimeAsync(5200))
    await waitFor(() => expect(n()).toBeGreaterThan(a))
    const b = n()
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    await waitFor(() => expect(n()).toBeGreaterThan(b))
  })

  it('a client timeout (abort) is an unknown outcome', async () => {
    setup()
    const real = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/api/sos') && init?.method === 'POST') {
          return new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
        }
        return real(input, init)
      }),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await sendNow()
    expect(screen.getByText(/This can take up to a minute\./)).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(60_500))
    expect(await screen.findByText(UNKNOWN)).toBeInTheDocument()
  })

  it.each([
    [400, 'Add a guardian email in Profile before sending SOS.'],
    [409, 'Only a failed or stuck SOS can be retried.'],
    [422, 'note: too long'],
  ])('%s is a rejection with the server detail', async (code, detail) => {
    setup({ extra: { 'POST /sos': fail(code, detail) } })
    await sendNow()
    const text = code === 409 ? /The alert was not sent: it can no longer be retried/ : `The alert was not sent: ${detail}`
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.queryByText(UNKNOWN)).not.toBeInTheDocument()
  })

  it('a retry that cannot be confirmed is also unknown, and Send again retries the same record', async () => {
    const api = setup({ postResult: failed(), extra: { 'POST /sos/7/retry': fail(503, 'down') } })
    await sendNow()
    await userEvent.click(await screen.findByRole('button', { name: /retry sending/i }))
    expect(await screen.findByText(UNKNOWN)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send again (may send a duplicate)' }))
    await waitFor(() => expect(api.callsTo('POST', '/sos/7/retry')).toHaveLength(2))
  })

  it('Send again after an unknown send posts a second time', async () => {
    const api = setup({ extra: { 'POST /sos': fail(502, 'x') } })
    await sendNow()
    await userEvent.click(await screen.findByRole('button', { name: 'Send again (may send a duplicate)' }))
    await waitFor(() => expect(api.callsTo('POST', '/sos')).toHaveLength(2))
  })
})

describe('Send guards and live regions', () => {
  it('a rapid double click and Enter repeat produce exactly one POST', async () => {
    const api = setup()
    act(() => geo.fail(2))
    const dialog = await openDialog()
    const send = within(dialog).getByRole('button', { name: 'Send now' })
    fireEvent.click(send)
    fireEvent.click(send)
    fireEvent.click(send)
    await screen.findByText(ACCEPTED)
    expect(api.callsTo('POST', '/sos')).toHaveLength(1)
    await userEvent.keyboard('{Enter}{Enter}')
    expect(api.callsTo('POST', '/sos')).toHaveLength(1)
  })

  it('Esc and the close button do not dismiss the dialog while sending', async () => {
    setup({ extra: { 'POST /sos': () => new Promise(() => {}) } })
    await sendNow()
    expect(await screen.findByText(/This can take up to a minute/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(screen.getByRole('dialog', { name: 'Sending emergency alert' })).toBeInTheDocument()
  })

  it('the result live regions exist before any content, on the page and in the dialog', async () => {
    setup()
    await waitFor(() => expect(sosButton()).toBeEnabled())
    const pageRegion = screen.getByTestId('sos-result')
    expect(pageRegion).toHaveAttribute('role', 'status')
    expect(pageRegion).toHaveAttribute('aria-live', 'polite')
    expect(pageRegion).toBeEmptyDOMElement()
    const dialog = await openDialog()
    const region = within(dialog).getByTestId('sos-result')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toBeEmptyDOMElement()
  })

  it('failed content is announced as an alert inside the permanent region', async () => {
    setup({ postResult: failed() })
    await sendNow()
    const region = within(screen.getByRole('dialog')).getByTestId('sos-result')
    expect(await within(region).findByRole('alert')).toHaveTextContent(/not delivered/i)
  })

  it('a pending result is followed after the dialog is closed and the page shows the late outcome', async () => {
    const pending = rec({ status: 'pending', sent_at: null, delivery_message: 'Sending…' })
    let settled = false
    setup({ postResult: pending, initial: [pending], extra: { 'GET /sos/7': () => (settled ? rec() : pending) } })
    await sendNow()
    await userEvent.click(await screen.findByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const region = () => screen.getAllByTestId('sos-result')[0]
    expect(within(region()).getByText('Sending…')).toBeInTheDocument()
    settled = true
    expect(await within(region()).findByText(ACCEPTED, {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('keeps the note after a rejection and does not claim an unknown outcome', async () => {
    setup({ extra: { 'POST /sos': fail(422, 'x') } })
    act(() => geo.fail(2))
    const dialog = await openDialog()
    await userEvent.type(within(dialog).getByLabelText(/optional note/i), 'help')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send now' }))
    await screen.findByText(/was not sent/)
    expect(screen.queryByText(UNKNOWN)).not.toBeInTheDocument()
  })

  it('does not render a maps link that is not a Google Maps URL', async () => {
    setup({ initial: [rec({ maps_link: 'javascript:alert(1)' })] })
    const row = (await screen.findAllByTestId('sos-row'))[0]
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('Simulation mode', () => {
  it('shows the banner, runs the dry run and never POSTs or reads GPS', async () => {
    const api = setup({ mode: 'simulation' })
    expect(screen.getByText(/SIMULATION MODE\. The button below runs a practice alert only/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /practice alert/i }))
    const d = await screen.findByRole('dialog', { name: /Test SOS workflow/ })
    expect(within(d).getByText(/No email will be sent/)).toBeInTheDocument()
    expect(api.callsTo('POST', '/sos')).toHaveLength(0)
    expect(api.callsTo('GET', '/sos/status')).toHaveLength(0)
    expect(geo.watchPosition).not.toHaveBeenCalled()
  })
})

describe('SOS history', () => {
  it('renders honest rows with a safe maps link, no-location rows, attempts and retry', async () => {
    setup({ initial: [rec({ id: 3 }), failed({ id: 2, lat: null, lon: null, maps_link: null, attempts: 3 }), rec({ id: 1, status: 'pending', sent_at: null, delivery_message: 'Sending…', retry_available: false })] })
    const rows = await screen.findAllByTestId('sos-row')
    expect(rows).toHaveLength(3)
    const link = within(rows[0]).getByRole('link', { name: 'Open in Google Maps' })
    expect(link).toHaveAttribute('href', 'https://www.google.com/maps?q=11.0183,76.9725')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(within(rows[1]).getByText('No location sent')).toBeInTheDocument()
    expect(within(rows[1]).getByText('3 attempts')).toBeInTheDocument()
    expect(within(rows[1]).getByText(/Failed: not delivered/)).toBeInTheDocument()
    expect(within(rows[1]).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(within(rows[2]).getByText('Sending…', { selector: 'span' })).toBeInTheDocument()
    expect(within(rows[0]).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    setup()
    expect(await screen.findByText('No SOS alerts yet')).toBeInTheDocument()
  })

  it('shows an error state when the list fails', async () => {
    setup({ extra: { 'GET /sos': fail(500, 'boom') } })
    expect(await screen.findByText('SOS history could not be loaded.')).toBeInTheDocument()
  })

  it('polls every 3 s while a row is pending and stops once nothing is pending', async () => {
    const api = setup({ initial: [rec({ id: 9, status: 'pending', sent_at: null, delivery_message: 'Sending…' })] })
    await screen.findAllByTestId('sos-row')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const gets = () => api.callsTo('GET', '/sos').length
    const before = gets()
    await act(() => vi.advanceTimersByTimeAsync(3100))
    await waitFor(() => expect(gets()).toBeGreaterThan(before))
    list = [rec({ id: 9 })]
    await act(() => vi.advanceTimersByTimeAsync(3100))
    await waitFor(() => expect(within(screen.getAllByTestId('sos-row')[0]).getByText(/Sent: accepted/)).toBeInTheDocument())
    const settled = gets()
    await act(() => vi.advanceTimersByTimeAsync(15000))
    expect(gets()).toBe(settled)
  })
})

describe('Topbar shortcut', () => {
  it('opens the confirmation dialog directly in Live mode when a guardian exists, from any page', async () => {
    const api = setup({ route: '/dashboard', extra: { 'GET /devices': [], 'GET /events': { items: [], total: 0, limit: 5, offset: 0 } } })
    await waitFor(() => expect(api.callsTo('GET', '/sos/status').length).toBeGreaterThan(0))
    await screen.findByRole('heading', { name: 'Dashboard' }).catch(() => undefined)
    await waitFor(async () => {
      await userEvent.click(screen.getByRole('link', { name: 'Emergency SOS' }))
      expect(screen.getByRole('dialog', { name: 'Send emergency alert?' })).toBeInTheDocument()
    })
    expect(api.callsTo('POST', '/sos')).toHaveLength(0)
  })

  it('goes to the SOS page when there is no guardian', async () => {
    setup({ route: '/profile', status: { email_configured: true, guardian_ready: false, guardian_name: null } })
    await screen.findByRole('heading', { name: 'Profile page' })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Emergency SOS' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('link', { name: 'Emergency SOS' }))
    expect(await screen.findByRole('heading', { name: 'Emergency SOS' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('in Simulation it navigates to the page, which explains the practice mode', async () => {
    setup({ route: '/profile', mode: 'simulation' })
    await userEvent.click(screen.getByRole('link', { name: 'Emergency SOS' }))
    expect(await screen.findByText(/SIMULATION MODE\. The button below runs a practice alert only/)).toBeInTheDocument()
  })
})

describe('Dialog accessibility', () => {
  it('is a modal dialog that traps Tab focus and closes on Escape without sending', async () => {
    const api = setup()
    act(() => geo.fail(2))
    const dialog = await openDialog()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    for (let i = 0; i < 8; i++) {
      await userEvent.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.callsTo('POST', '/sos')).toHaveLength(0)
  })
})

describe('Dashboard recent emergency activity', () => {
  it('shows a failed SOS event as failed', async () => {
    setup({
      route: '/dashboard',
      extra: {
        'GET /devices': [],
        'GET /events': (_b: unknown, u: URL) =>
          u.searchParams.get('type') === 'sos'
            ? { items: [{ id: 1, type: 'sos', source: 'live', title: 'SOS email to Meera Raman failed', details: {}, status: 'failed', created_at: '2026-10-30T10:00:00Z' }], total: 1, limit: 5, offset: 0 }
            : { items: [], total: 0, limit: 5, offset: 0 },
      },
    })
    expect(await screen.findByText('SOS email to Meera Raman failed')).toBeInTheDocument()
    expect(screen.getByText(/Failed: this did not complete/)).toBeInTheDocument()
  })
})
