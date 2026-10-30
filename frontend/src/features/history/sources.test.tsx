import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { History } from './History'
import { sourcesForMode, useRecentEvents } from './useEvents'

const ev = (id: number, source: string, title: string, at: string, type = 'obstacle') => ({
  id,
  type,
  source,
  title,
  details: {},
  status: 'ok',
  created_at: at,
})

function Recent() {
  const q = useRecentEvents('obstacle')
  return (
    <ul>
      {(q.data?.items ?? []).map((e) => (
        <li key={e.id}>{e.title}</li>
      ))}
    </ul>
  )
}

afterEach(() => vi.unstubAllGlobals())

function eventsApi() {
  return mockApi({
    'GET /events': (_b: unknown, url: URL) => {
      const source = url.searchParams.get('source')
      const all = [
        ev(1, 'live', 'Live obstacle', '2026-01-01T10:00:00Z'),
        ev(2, 'hardware', 'Hardware obstacle', '2026-01-01T11:00:00Z'),
        ev(3, 'simulation', 'Simulated obstacle', '2026-01-01T12:00:00Z'),
      ]
      const items = source ? all.filter((e) => e.source === source) : all
      return { items, total: items.length, limit: 20, offset: 0 }
    },
  })
}

describe('source separation', () => {
  it('maps modes to allowed sources', () => {
    expect(sourcesForMode('live')).toEqual(['live', 'hardware'])
    expect(sourcesForMode('simulation')).toEqual(['simulation'])
  })

  it('Live mode recent lists request live and hardware separately, merge them, and never show simulation', async () => {
    const api = eventsApi()
    renderApp(<Recent />, { mode: 'live' })
    await screen.findByText('Hardware obstacle')
    expect(screen.getByText('Live obstacle')).toBeInTheDocument()
    expect(screen.queryByText('Simulated obstacle')).not.toBeInTheDocument()
    const sources = api.callsTo('GET', '/events').map((c) => new URLSearchParams(c.search).get('source'))
    expect(sources.sort()).toEqual(['hardware', 'live'])
    // newest first
    const items = screen.getAllByRole('listitem').map((l) => l.textContent)
    expect(items).toEqual(['Hardware obstacle', 'Live obstacle'])
  })

  it('Live mode filters client-side too if a server ever returned a simulation event', async () => {
    mockApi({
      'GET /events': { items: [ev(9, 'simulation', 'Leaked simulation', '2026-01-01T09:00:00Z')], total: 1, limit: 5, offset: 0 },
    })
    renderApp(<Recent />, { mode: 'live' })
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Leaked simulation')).not.toBeInTheDocument()
  })

  it('Simulation mode shows only simulation events', async () => {
    const api = eventsApi()
    renderApp(<Recent />, { mode: 'simulation' })
    await screen.findByText('Simulated obstacle')
    expect(screen.queryByText('Live obstacle')).not.toBeInTheDocument()
    expect(api.callsTo('GET', '/events').map((c) => new URLSearchParams(c.search).get('source'))).toEqual(['simulation'])
  })

  it('Activity History opens on the current mode source', async () => {
    const api = eventsApi()
    const live = renderApp(<History />, { mode: 'live' })
    await screen.findByText('Live obstacle')
    expect(api.callsTo('GET', '/events')[0].search).toContain('source=live')
    expect(screen.queryByText('Simulated obstacle')).not.toBeInTheDocument()
    live.unmount()
    const api2 = eventsApi()
    renderApp(<History />, { mode: 'simulation' })
    await screen.findByText('Simulated obstacle')
    expect(api2.callsTo('GET', '/events')[0].search).toContain('source=simulation')
  })
})
