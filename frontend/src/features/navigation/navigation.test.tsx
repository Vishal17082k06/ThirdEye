import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, fail, mockApi } from '../../test-api'
import { installFakeGeolocation, type FakeGeo } from '../../test-geo'
import { makeRoute, routePoints } from '../../test-routes'
import { renderApp } from '../../test-utils'
import type { Mode } from '../../lib/mode'
import { navigationController } from './controller'

const speech = vi.hoisted(() => ({
  speak: vi.fn((..._args: unknown[]) => true),
  cancel: vi.fn(),
  announce: vi.fn((..._args: unknown[]) => true),
  resetDedupe: vi.fn(),
  supported: true,
  speaking: false,
  voiceEnabled: true,
}))
vi.mock('../../hooks/useSpeech', () => ({ useSpeech: () => speech }))
vi.mock('../maps/MapView', async () => import('../../test-map'))

import { NavigationPage } from './NavigationPage'
import { useWhereAmI } from './useWhereAmI'

const GANDHIPURAM = { lat: 11.0183, lon: 76.9725 }
const RACE_COURSE = { lat: 11.001, lon: 76.966 }
const BOUNDS = {
  bounds: { south: 10.85, west: 76.85, north: 11.15, east: 77.15 },
  centre: { lat: 11.0168, lon: 76.9558 },
  message: 'Third Eye navigation is currently limited to Coimbatore, Tamil Nadu. Please choose a place inside the Coimbatore service area.',
}

let geo: FakeGeo
let routeHandler: (b: unknown, u: URL) => unknown

function setup(mode: Mode = 'live', extra: Record<string, unknown> = {}) {
  geo = installFakeGeolocation()
  routeHandler = (_b, u) => makeRoute(u.searchParams.get('mode') as 'foot', GANDHIPURAM, RACE_COURSE)
  const api = mockApi({
    'GET /settings': DEFAULT_SETTINGS,
    'GET /nav/bounds': BOUNDS,
    'GET /nav/route': (b: unknown, u: URL) => routeHandler(b, u),
    'GET /nav/reverse': { label: 'Race Course Road, Coimbatore' },
    'POST /events': { id: 1 },
    ...extra,
  })
  const view = renderApp(<NavigationPage />, { route: '/navigation', mode })
  return { api, ...view }
}

const eventsOf = (api: ReturnType<typeof mockApi>) => api.callsTo('POST', '/events').map((c) => c.body as Record<string, unknown>)

async function chooseDestinationOnMap(user: ReturnType<typeof userEvent.setup>, spot: string) {
  await user.click(screen.getByRole('button', { name: 'Choose destination on map' }))
  await user.click(screen.getByRole('button', { name: `map click: ${spot}` }))
}

beforeEach(() => {
  navigationController.reset()
  speech.speak.mockClear()
  speech.cancel.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('Navigation: location and planning', () => {
  it('rejects a destination outside Coimbatore with the restriction message and never asks for a route', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
    await screen.findByText('GPS live')
    await chooseDestinationOnMap(user, 'Bengaluru')
    expect(await screen.findByText(/limited to Coimbatore, Tamil Nadu/)).toBeInTheDocument()
    expect(api.callsTo('GET', '/nav/route')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Start navigation' })).toBeDisabled()
  })

  it('offers manual start selection when GPS is denied, and routes from the chosen point', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    act(() => geo.fail(1))
    expect(await screen.findByText(/Location permission was denied/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try GPS again' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Starting point' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Choose starting point on map' }))
    await user.click(screen.getByRole('button', { name: 'map click: Gandhipuram' }))
    await chooseDestinationOnMap(user, 'Race Course')

    await waitFor(() => expect(api.callsTo('GET', '/nav/route')).toHaveLength(1))
    const q = new URLSearchParams(api.callsTo('GET', '/nav/route')[0].search)
    expect(q.get('from_lat')).toBe('11.0183')
    expect(q.get('to_lat')).toBe('11.001')
    expect(q.get('mode')).toBe('foot')
    expect(await screen.findByText('Turn-by-turn directions')).toBeInTheDocument()
    expect(screen.getByText(/Head south on Avinashi Road/)).toBeInTheDocument()
  })

  it('says so when GPS is outside the service area and asks for a manual start', async () => {
    setup()
    act(() => geo.emit(12.9716, 77.5946))
    expect(await screen.findByText(/GPS position is outside the Coimbatore service area/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Starting point' })).toBeInTheDocument()
  })

  it('shows distance, estimated time and an estimated arrival clock time', async () => {
    const user = userEvent.setup()
    setup()
    act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
    await chooseDestinationOnMap(user, 'Race Course')
    expect(await screen.findByText('2.1 km')).toBeInTheDocument()
    expect(screen.getByText('25 min')).toBeInTheDocument()
    expect(screen.getByText('Arrive about')).toBeInTheDocument()
    expect(screen.getAllByText('estimated').length).toBe(2)
  })

  it('refetches for the chosen travel mode', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
    await chooseDestinationOnMap(user, 'Race Course')
    await screen.findByText('2.1 km')
    await user.click(screen.getByRole('radio', { name: 'Car' }))
    await waitFor(() => expect(api.callsTo('GET', '/nav/route')).toHaveLength(2))
    expect(new URLSearchParams(api.callsTo('GET', '/nav/route')[1].search).get('mode')).toBe('car')
  })

  it('reports an unavailable bicycle profile honestly', async () => {
    const user = userEvent.setup()
    setup()
    act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
    await chooseDestinationOnMap(user, 'Race Course')
    await screen.findByText('2.1 km')
    routeHandler = () => fail(404, 'Bicycle routing is not available for this trip')
    await user.click(screen.getByRole('radio', { name: 'Bicycle' }))
    expect(await screen.findByText('Bicycle routing is not available for this trip')).toBeInTheDocument()
    expect(screen.queryByText('Turn-by-turn directions')).not.toBeInTheDocument()
  })

  it('words a routing provider failure for people', async () => {
    const user = userEvent.setup()
    setup()
    act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
    routeHandler = () => fail(502, 'Routing provider error')
    await chooseDestinationOnMap(user, 'Race Course')
    expect(await screen.findByText('Routing service is unavailable right now. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start navigation' })).toBeDisabled()
  })
})

describe('Navigation: a trip', () => {
  async function startTrip() {
    const user = userEvent.setup()
    const ctx = setup()
    act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
    await chooseDestinationOnMap(user, 'Race Course')
    await screen.findByText('2.1 km')
    await user.click(screen.getByRole('button', { name: 'Start navigation' }))
    return { user, ...ctx }
  }

  it('starting and stopping post navigation events tagged live and speak the first instruction', async () => {
    const { user, api } = await startTrip()
    expect(await screen.findByRole('button', { name: 'Stop navigation' })).toBeInTheDocument()
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith('Head south on Avinashi Road', { interrupt: true }))
    await waitFor(() => expect(eventsOf(api)).toHaveLength(1))
    expect(eventsOf(api)[0]).toMatchObject({
      type: 'navigation',
      source: 'live',
      status: 'started',
      details: { mode: 'foot', distance_m: 2100, duration_s: 1500, destination: { lat: 11.001, lon: 76.966 } },
    })
    expect(String(eventsOf(api)[0].title)).toContain('Navigation started to')

    await user.click(screen.getByRole('button', { name: 'Stop navigation' }))
    await waitFor(() => expect(eventsOf(api)).toHaveLength(2))
    expect(eventsOf(api)[1]).toMatchObject({
      type: 'navigation',
      source: 'live',
      status: 'stopped',
      details: { mode: 'foot', arrived: false, planned_distance_m: 2100 },
    })
    expect(typeof (eventsOf(api)[1].details as { duration_s: number }).duration_s).toBe('number')
    expect(speech.cancel).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Start navigation' })).toBeInTheDocument()
  })

  it('announces the next manoeuvre within 40 m, highlights the current step, and announces arrival once', async () => {
    const { api } = await startTrip()
    await waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1))
    const pts = routePoints(makeRoute('foot', GANDHIPURAM, RACE_COURSE))

    // 300 m before the turn: nothing is said yet
    act(() => geo.emit(pts[2].lat, pts[2].lon))
    expect(speech.speak).toHaveBeenCalledTimes(1)

    // about 11 m before the turn (the route heads south, so "before" is slightly north of it)
    act(() => geo.emit(pts[5].lat + 0.0001, pts[5].lon + 0.00004))
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith('Turn left onto Race Course Road', { interrupt: true }))
    // a second fix at the same spot does not repeat it
    act(() => geo.emit(pts[5].lat + 0.00005, pts[5].lon + 0.00002))
    expect(speech.speak.mock.calls.filter((c) => c[0] === 'Turn left onto Race Course Road')).toHaveLength(1)
    const stepNow = () => screen.getByRole('list', { name: 'Directions' }).querySelector('[aria-current="step"]')
    expect(stepNow()).toHaveTextContent('Head south on Avinashi Road') // not at the turn yet
    act(() => geo.emit(pts[5].lat - 0.0002, pts[5].lon))
    await waitFor(() => expect(stepNow()).toHaveTextContent('Turn left onto Race Course Road'))

    act(() => geo.emit(pts[10].lat, pts[10].lon))
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith('You have arrived.', { interrupt: true }))
    expect((await screen.findAllByText(/You have arrived at/)).length).toBeGreaterThan(0)
    await waitFor(() => expect(eventsOf(api)).toHaveLength(2))
    expect(eventsOf(api)[1]).toMatchObject({ status: 'completed', details: { arrived: true } })
    expect(screen.getByRole('button', { name: 'Start navigation' })).toBeInTheDocument()
  })

  it('reroutes after 3 consecutive fixes beyond 50 m, says "Rerouting.", and only once per 15 seconds', async () => {
    const { api } = await startTrip()
    await waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1))
    const pts = routePoints(makeRoute('foot', GANDHIPURAM, RACE_COURSE))
    const off = (i: number, k = 1) => geo.emit(pts[i].lat, pts[i].lon + 0.0012 * k) // about 130 m east of the route
    expect(api.callsTo('GET', '/nav/route')).toHaveLength(1)

    act(() => off(2))
    act(() => off(2))
    expect(speech.speak.mock.calls.some((c) => c[0] === 'Rerouting.')).toBe(false)
    act(() => geo.emit(pts[2].lat, pts[2].lon)) // back on the route: the count restarts
    act(() => off(2))
    act(() => off(2))
    expect(speech.speak.mock.calls.some((c) => c[0] === 'Rerouting.')).toBe(false)
    act(() => off(2))
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith('Rerouting.', { interrupt: true }))
    await waitFor(() => expect(api.callsTo('GET', '/nav/route')).toHaveLength(2))
    const q = new URLSearchParams(api.callsTo('GET', '/nav/route')[1].search)
    expect(Number(q.get('from_lon'))).toBeCloseTo(pts[2].lon + 0.0012, 5)

    // still lost, but inside the 15 s window: no second reroute
    act(() => off(3))
    act(() => off(3))
    act(() => off(3))
    act(() => off(3))
    expect(speech.speak.mock.calls.filter((c) => c[0] === 'Rerouting.')).toHaveLength(1)
    expect(api.callsTo('GET', '/nav/route')).toHaveLength(2)
  })

  it('says GPS signal lost when the device stops reporting during a trip', async () => {
    await startTrip()
    await waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1))
    act(() => geo.fail(3))
    expect(await screen.findByText(/GPS signal lost\. Navigation is paused/)).toBeInTheDocument()
    expect(speech.speak).toHaveBeenCalledWith('GPS signal lost.', { interrupt: true })
  })

  it('leaving the page ends the trip, stops speech and logs the stop', async () => {
    const { api, unmount } = await startTrip()
    await waitFor(() => expect(eventsOf(api)).toHaveLength(1))
    unmount()
    await waitFor(() => expect(eventsOf(api)).toHaveLength(2))
    expect(eventsOf(api)[1]).toMatchObject({ status: 'stopped' })
    expect(navigationController.getState().navigating).toBe(false)
    expect(geo.clearWatch).toHaveBeenCalled()
  })
})

describe('Navigation: Simulation mode', () => {
  it('is labelled SIMULATION MODE and never touches the real GPS', async () => {
    const user = userEvent.setup()
    setup('simulation')
    expect(screen.getByText(/SIMULATION MODE\. Real GPS is not used here/)).toBeInTheDocument()
    expect(screen.getByText('Simulated')).toBeInTheDocument()
    expect(geo.watchPosition).not.toHaveBeenCalled()
    expect(geo.getCurrentPosition).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: 'Starting point' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Use sample start (Gandhipuram)' }))
    await chooseDestinationOnMap(user, 'Race Course')
    expect(await screen.findByText('2.1 km')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Simulate walking along the route' })).not.toBeInTheDocument()
    expect(geo.watchPosition).not.toHaveBeenCalled()
  })

  it('walks a simulated position along the route, tags events simulation and arrives', async () => {
    const user = userEvent.setup()
    // a 55 m route: two 30 m ticks finish it
    const { api } = setup('simulation', {
      'GET /nav/route': () => makeRoute('foot', GANDHIPURAM, { lat: 11.0183 - 0.0005, lon: 76.9725 }, { distance_m: 55, duration_s: 40 }),
    })
    await user.click(screen.getByRole('button', { name: 'Use sample start (Gandhipuram)' }))
    await user.click(screen.getByRole('button', { name: 'Choose destination on map' }))
    await user.click(screen.getByRole('button', { name: 'map click: Race Course' }))
    await screen.findByText('Turn-by-turn directions')
    await user.click(screen.getByRole('button', { name: 'Start navigation' }))
    await user.click(await screen.findByRole('button', { name: 'Simulate walking along the route' }))
    expect(await screen.findByText(/SIMULATED position: moves 30 m every 1 s/)).toBeInTheDocument()
    expect(await screen.findByText('Simulated guidance')).toBeInTheDocument()
    expect(screen.getByTestId('current-marker')).toHaveTextContent('Simulated position')

    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith('You have arrived.', { interrupt: true }), { timeout: 5000 })
    await waitFor(() => expect(eventsOf(api)).toHaveLength(2))
    expect(eventsOf(api).map((e) => e.source)).toEqual(['simulation', 'simulation'])
    expect(eventsOf(api)[1]).toMatchObject({ status: 'completed', details: { simulated_path: true, arrived: true } })
    expect(geo.watchPosition).not.toHaveBeenCalled()
  })
})

describe('NavigationController', () => {
  it('refuses a destination outside the service area and a start without a destination', () => {
    const r = navigationController.setDestination({ lat: 12.97, lon: 77.59, label: 'Bengaluru' })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/limited to Coimbatore/)
    expect(navigationController.start().ok).toBe(false)
    expect(navigationController.getState().navigating).toBe(false)
  })

  it('stores destination and mode, and ignores unknown modes', () => {
    expect(navigationController.setDestination({ lat: 11.001, lon: 76.966, label: 'Race Course' }).ok).toBe(true)
    navigationController.setMode('car')
    navigationController.setMode('rocket' as never)
    expect(navigationController.getState()).toMatchObject({ mode: 'car', destination: { label: 'Race Course' } })
    expect(navigationController.start().ok).toBe(true)
    expect(navigationController.getState().navigating).toBe(true)
    navigationController.stop()
    expect(navigationController.getState().navigating).toBe(false)
  })

  it('the page follows a destination and mode set from outside (the voice assistant)', async () => {
    const { api } = setup()
    act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
    await screen.findByText('GPS live')
    act(() => {
      navigationController.setDestination({ lat: 11.001, lon: 76.966, label: 'Race Course' })
      navigationController.setMode('car')
    })
    await waitFor(() => expect(api.callsTo('GET', '/nav/route')).toHaveLength(1))
    expect(new URLSearchParams(api.callsTo('GET', '/nav/route')[0].search).get('mode')).toBe('car')
    expect(screen.getByRole('radio', { name: 'Car' })).toBeChecked()
    await screen.findByText('2.1 km')
    act(() => {
      navigationController.start()
    })
    expect(await screen.findByRole('button', { name: 'Stop navigation' })).toBeInTheDocument()
    act(() => {
      navigationController.stop()
    })
    expect(await screen.findByRole('button', { name: 'Start navigation' })).toBeInTheDocument()
  })
})

describe('Where am I?', () => {
  it('reverse geocodes the current GPS position, shows and speaks the address', async () => {
    const user = userEvent.setup()
    setup()
    act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
    await screen.findByText('GPS live')
    await user.click(screen.getByRole('button', { name: 'Where am I?' }))
    expect(await screen.findByText('You are near Race Course Road, Coimbatore.')).toBeInTheDocument()
    expect(speech.speak).toHaveBeenCalledWith('You are near Race Course Road, Coimbatore.', { interrupt: true })
  })

  it('useWhereAmI().ask() works on its own and is honest about being outside the area', async () => {
    mockApi({ 'GET /nav/reverse': { label: 'Somewhere' } })
    const fake = installFakeGeolocation()
    fake.getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok({ coords: { latitude: 12.97, longitude: 77.59, accuracy: 5 }, timestamp: 1 } as GeolocationPosition),
    )
    let ask: () => Promise<string> = async () => ''
    function Probe() {
      const hook = useWhereAmI()
      useEffect(() => {
        ask = hook.ask
      })
      return null
    }
    renderApp(<Probe />, { mode: 'live' })
    const text = await ask()
    expect(text).toMatch(/outside the Coimbatore service area/)
    expect(speech.speak).toHaveBeenCalledWith(text, { interrupt: true })
  })

  it('says it cannot use GPS in Simulation mode when no position is set', async () => {
    const fake = installFakeGeolocation()
    let ask: () => Promise<string> = async () => ''
    function Probe() {
      const hook = useWhereAmI()
      useEffect(() => {
        ask = hook.ask
      })
      return null
    }
    renderApp(<Probe />, { mode: 'simulation' })
    const text = await ask()
    expect(text).toMatch(/Simulation mode does not use real GPS/)
    expect(fake.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('reports a GPS failure in words', async () => {
    const fake = installFakeGeolocation()
    fake.getCurrentPosition.mockImplementation((_ok: PositionCallback, err: PositionErrorCallback) => err({ code: 2 } as GeolocationPositionError))
    let ask: () => Promise<string> = async () => ''
    function Probe() {
      const hook = useWhereAmI()
      useEffect(() => {
        ask = hook.ask
      })
      return null
    }
    renderApp(<Probe />, { mode: 'live' })
    expect(await ask()).toMatch(/GPS not available/)
  })
})
