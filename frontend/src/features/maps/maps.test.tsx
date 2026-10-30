import { render, renderHook, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { mockApi, fail } from '../../test-api'
import { fetchRoute, FALLBACK_AREA, navErrorMessage, rideModeToRoute, useGeocode, useServiceArea, type Place } from './api'
import { CoordinateEntry } from './CoordinateEntry'
import { PlaceSearch } from './PlaceSearch'

const RESULTS = {
  results: [
    { label: 'Gandhipuram, Coimbatore', lat: 11.0183, lon: 76.9725, kind: 'suburb' },
    { label: 'Gandhipuram Bus Stand', lat: 11.0168, lon: 76.9674, kind: 'bus_station' },
  ],
  note: null,
}

afterEach(() => vi.unstubAllGlobals())

function Harness({ onSelect }: { onSelect: (p: Place) => void }) {
  const [value, setValue] = useState<Place | null>(null)
  return (
    <PlaceSearch
      label="Destination"
      value={value}
      onSelect={(p) => {
        setValue(p)
        onSelect(p)
      }}
      onEdit={() => setValue(null)}
    />
  )
}

describe('PlaceSearch combobox', () => {
  it('does not search for fewer than two characters', async () => {
    const api = mockApi({ 'GET /nav/geocode': RESULTS })
    const user = userEvent.setup()
    render(<Harness onSelect={() => undefined} />)
    await user.type(screen.getByRole('combobox', { name: 'Destination' }), 'G')
    await new Promise((r) => setTimeout(r, 600))
    expect(api.callsTo('GET', '/nav/geocode')).toHaveLength(0)
  })

  it('debounces typing into one request and moves through options with the arrow keys', async () => {
    const api = mockApi({ 'GET /nav/geocode': RESULTS })
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const box = screen.getByRole('combobox', { name: 'Destination' })
    await user.type(box, 'Gandhipuram')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(api.callsTo('GET', '/nav/geocode')).toHaveLength(1)
    expect(api.callsTo('GET', '/nav/geocode')[0].search).toContain('q=Gandhipuram')
    expect(box).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{ArrowDown}')
    expect(box).toHaveAttribute('aria-activedescendant', options[0].id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(box).toHaveAttribute('aria-activedescendant', options[1].id)
    await user.keyboard('{ArrowDown}')
    expect(box).toHaveAttribute('aria-activedescendant', options[0].id) // wraps
    await user.keyboard('{ArrowUp}')
    expect(box).toHaveAttribute('aria-activedescendant', options[1].id)

    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith({ lat: 11.0168, lon: 76.9674, label: 'Gandhipuram Bus Stand' })
    expect(box).toHaveValue('Gandhipuram Bus Stand')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('Escape closes the list without choosing', async () => {
    mockApi({ 'GET /nav/geocode': RESULTS })
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await user.type(screen.getByRole('combobox'), 'Gandhi')
    await screen.findAllByRole('option')
    await user.keyboard('{ArrowDown}{Escape}')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('says so when nothing matches inside Coimbatore', async () => {
    mockApi({ 'GET /nav/geocode': { results: [], note: 'No matching places inside Coimbatore' } })
    const user = userEvent.setup()
    render(<Harness onSelect={() => undefined} />)
    await user.type(screen.getByRole('combobox'), 'Bengaluru')
    expect(await screen.findByText('No matching places inside Coimbatore')).toBeInTheDocument()
  })

  it('reports a provider failure honestly', async () => {
    mockApi({ 'GET /nav/geocode': fail(502, 'upstream') })
    const user = userEvent.setup()
    render(<Harness onSelect={() => undefined} />)
    await user.type(screen.getByRole('combobox'), 'Gandhi')
    expect(await screen.findByText(/Place search is unavailable right now/)).toBeInTheDocument()
  })
})

describe('useGeocode', () => {
  it('aborts the previous request when the query changes', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        signals.push(init!.signal as AbortSignal)
        return new Promise<Response>((resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          setTimeout(() => resolve(new Response(JSON.stringify(RESULTS))), 3000)
        })
      }),
    )
    const { rerender } = renderHook(({ q }) => useGeocode(q), { initialProps: { q: 'Gan' } })
    await waitFor(() => expect(signals).toHaveLength(1))
    rerender({ q: 'Gandhi' })
    await waitFor(() => expect(signals).toHaveLength(2))
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })
})

describe('CoordinateEntry', () => {
  const area = FALLBACK_AREA
  it('submits valid in-area coordinates', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<CoordinateEntry area={area} onSubmit={onSubmit} submitLabel="Set it" />)
    await user.type(screen.getByLabelText('Latitude'), '11.0168')
    await user.type(screen.getByLabelText('Longitude'), '76.9558')
    await user.click(screen.getByRole('button', { name: 'Set it' }))
    expect(onSubmit).toHaveBeenCalledWith(11.0168, 76.9558)
  })
  it('refuses outside the service area with the restriction message', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<CoordinateEntry area={area} onSubmit={onSubmit} submitLabel="Set it" />)
    await user.type(screen.getByLabelText('Latitude'), '12.97')
    await user.type(screen.getByLabelText('Longitude'), '77.59')
    await user.click(screen.getByRole('button', { name: 'Set it' }))
    expect(screen.getByRole('alert')).toHaveTextContent('limited to Coimbatore')
    expect(onSubmit).not.toHaveBeenCalled()
  })
  it('notices swapped latitude and longitude', async () => {
    const user = userEvent.setup()
    render(<CoordinateEntry area={area} onSubmit={vi.fn()} submitLabel="Set it" />)
    await user.type(screen.getByLabelText('Latitude'), '76.9558')
    await user.type(screen.getByLabelText('Longitude'), '11.0168')
    await user.click(screen.getByRole('button', { name: 'Set it' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/look swapped/)
  })
  it('rejects non-numbers', async () => {
    const user = userEvent.setup()
    render(<CoordinateEntry area={area} onSubmit={vi.fn()} submitLabel="Set it" />)
    await user.type(screen.getByLabelText('Latitude'), 'abc')
    await user.type(screen.getByLabelText('Longitude'), '76.9')
    await user.click(screen.getByRole('button', { name: 'Set it' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/as numbers/)
  })
})

describe('maps api', () => {
  it('maps ride modes to routing modes', () => {
    expect(rideModeToRoute('walk')).toBe('foot')
    expect(rideModeToRoute('car')).toBe('car')
    expect(rideModeToRoute('bike')).toBe('bike')
  })

  it('refuses an out-of-area route before any request is made', async () => {
    const api = mockApi({})
    await expect(fetchRoute({ lat: 12.97, lon: 77.59 }, { lat: 11.0, lon: 76.96 }, 'car')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('limited to Coimbatore'),
    })
    expect(api.fn).not.toHaveBeenCalled()
  })

  it('requests the route with the right query', async () => {
    const api = mockApi({ 'GET /nav/route': { mode: 'foot', distance_m: 1, duration_s: 1, geometry: { type: 'LineString', coordinates: [] }, steps: [], provider: 'x' } })
    await fetchRoute({ lat: 11.0183, lon: 76.9725 }, { lat: 11.001, lon: 76.966 }, 'foot')
    const q = new URLSearchParams(api.calls[0].search)
    expect(q.get('from_lat')).toBe('11.0183')
    expect(q.get('to_lon')).toBe('76.966')
    expect(q.get('mode')).toBe('foot')
  })

  it('words errors for people', () => {
    expect(navErrorMessage(new ApiError(502, 'x'))).toBe('Routing service is unavailable right now. Try again.')
    expect(navErrorMessage(new ApiError(404, 'No route could be found between these places'))).toBe('No route could be found between these places')
    expect(navErrorMessage(new ApiError(422, 'Third Eye navigation is currently limited to Coimbatore'))).toContain('limited to Coimbatore')
  })

  it('useServiceArea uses the server box and falls back to the built-in one', async () => {
    mockApi({
      'GET /nav/bounds': { bounds: { south: 10.9, west: 76.9, north: 11.1, east: 77.1 }, centre: { lat: 11, lon: 77 }, message: 'Only Coimbatore.' },
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useServiceArea(), { wrapper })
    expect(result.current).toBe(FALLBACK_AREA)
    await waitFor(() => expect(result.current.bounds.south).toBe(10.9))
    expect(result.current.message).toBe('Only Coimbatore.')
  })

  it('useServiceArea keeps the fallback when the call fails', async () => {
    mockApi({ 'GET /nav/bounds': fail(500, 'boom') })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useServiceArea(), { wrapper })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(result.current).toBe(FALLBACK_AREA)
  })
})
