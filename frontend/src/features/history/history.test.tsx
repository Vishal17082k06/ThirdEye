import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { History } from './History'
import { buildEventsQuery } from './useEvents'

const ev = (id: number, source: string, title: string, extra: object = {}) => ({
  id,
  type: 'obstacle',
  source,
  title,
  details: { label: 'chair', distance_m: 1.2 },
  status: 'ok',
  created_at: '2026-10-30T10:00:00Z',
  ...extra,
})

afterEach(() => vi.unstubAllGlobals())

describe('buildEventsQuery', () => {
  it('omits empty filters and encodes the rest', () => {
    expect(buildEventsQuery({})).toBe('')
    expect(buildEventsQuery({ type: 'sos', source: 'simulation', q: ' door open ', from: '2026-01-01', to: '2026-01-31', limit: 20, offset: 40 })).toBe(
      'type=sos&source=simulation&q=door+open&from=2026-01-01&to=2026-01-31&limit=20&offset=40',
    )
  })
})

describe('History page', () => {
  it('labels simulation, live and hardware events distinctly', async () => {
    mockApi({
      'GET /events': {
        items: [ev(1, 'simulation', 'Chair ahead'), ev(2, 'live', 'Door ahead'), ev(3, 'hardware', 'Sensor reading')],
        total: 3,
        limit: 20,
        offset: 0,
      },
    })
    renderApp(<History />)
    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0]).getByText('Simulation')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Live')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Hardware')).toBeInTheDocument()
  })

  it('sends filters as query params (search is debounced)', async () => {
    const api = mockApi({ 'GET /events': { items: [], total: 0, limit: 20, offset: 0 } })
    renderApp(<History />)
    await screen.findByText('No activity yet')
    await userEvent.selectOptions(screen.getByLabelText('Event type'), 'ride')
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'simulation')
    await userEvent.type(screen.getByLabelText('From'), '2026-10-01')
    await userEvent.type(screen.getByLabelText('To'), '2026-10-30')
    await userEvent.type(screen.getByLabelText('Search'), 'cab')
    await waitFor(() => {
      const last = api.callsTo('GET', '/events').at(-1)!
      const p = new URLSearchParams(last.search)
      expect(Object.fromEntries(p)).toEqual({
        type: 'ride',
        source: 'simulation',
        q: 'cab',
        from: '2026-10-01',
        to: '2026-10-30',
        limit: '20',
        offset: '0',
      })
    })
    // Typing 3 letters must not have produced one request per letter.
    const withQ = api.callsTo('GET', '/events').filter((c) => new URLSearchParams(c.search).has('q'))
    expect(withQ.length).toBe(1)
    expect(await screen.findByText('No events match these filters')).toBeInTheDocument()
  })

  it('opens a detail dialog with the JSON details', async () => {
    mockApi({ 'GET /events': { items: [ev(1, 'live', 'Chair ahead')], total: 1, limit: 20, offset: 0 } })
    renderApp(<History />)
    await userEvent.click(await screen.findByRole('button', { name: /Chair ahead/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Event details as JSON')).toHaveTextContent('"distance_m": 1.2')
  })

  it('loads more with the next offset', async () => {
    const api = mockApi({
      'GET /events': (_b: unknown, url: URL) => {
        const offset = Number(url.searchParams.get('offset'))
        return { items: [ev(offset + 1, 'live', `Event ${offset + 1}`)], total: 2, limit: 20, offset }
      },
    })
    renderApp(<History />)
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Event 2')).toBeInTheDocument()
    expect(api.callsTo('GET', '/events').at(-1)!.search).toContain('offset=1')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('shows an error state with retry', async () => {
    let fail = true
    mockApi({
      'GET /events': () => (fail ? { __status: 500, body: { detail: 'Boom' } } : { items: [], total: 0, limit: 20, offset: 0 }),
    })
    renderApp(<History />)
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No activity yet')).toBeInTheDocument()
  })

  it('does not query when the date range is reversed', async () => {
    const api = mockApi({ 'GET /events': { items: [], total: 0, limit: 20, offset: 0 } })
    renderApp(<History />)
    await screen.findByText('No activity yet')
    const before = api.callsTo('GET', '/events').length
    await userEvent.type(screen.getByLabelText('From'), '2026-10-30')
    await userEvent.type(screen.getByLabelText('To'), '2026-10-01')
    expect(screen.getByText('The start date must be on or before the end date.')).toBeInTheDocument()
    // No request may ever carry from > to.
    for (const c of api.callsTo('GET', '/events').slice(before)) {
      const p = new URLSearchParams(c.search)
      if (p.get('from') && p.get('to')) expect(p.get('from')! <= p.get('to')!).toBe(true)
    }
    const countAfterTyping = api.callsTo('GET', '/events').length
    await new Promise((r) => setTimeout(r, 400))
    expect(api.callsTo('GET', '/events').length).toBe(countAfterTyping)
  })
})
