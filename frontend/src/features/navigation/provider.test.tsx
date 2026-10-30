import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMode } from '../../lib/mode'
import { DEFAULT_SETTINGS, mockApi } from '../../test-api'
import { installFakeGeolocation, type FakeGeo } from '../../test-geo'
import { makeRoute, routePoints } from '../../test-routes'
import { renderApp } from '../../test-utils'
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

import { NavigationBar } from './NavigationBar'
import { NavigationPage } from './NavigationPage'
import { NavigationProvider } from './NavigationProvider'
import { navTiming } from './useNavigation'

const GANDHIPURAM = { lat: 11.0183, lon: 76.9725 }
const RACE_COURSE = { lat: 11.001, lon: 76.966 }
const PTS = routePoints(makeRoute('foot', GANDHIPURAM, RACE_COURSE))
const BOUNDS = {
  bounds: { south: 10.85, west: 76.85, north: 11.15, east: 77.15 },
  centre: { lat: 11.0168, lon: 76.9558 },
  message: 'Third Eye navigation is currently limited to Coimbatore, Tamil Nadu. Please choose a place inside the Coimbatore service area.',
}

function ModeSwitch() {
  const { setMode } = useMode()
  return (
    <button type="button" onClick={() => setMode('simulation')}>
      switch to simulation
    </button>
  )
}

function Layout() {
  return (
    <NavigationProvider>
      <NavigationBar />
      <nav>
        <Link to="/rides">go rides</Link>
        <Link to="/navigation">go nav</Link>
        <ModeSwitch />
      </nav>
      <Routes>
        <Route path="/navigation" element={<NavigationPage />} />
        <Route path="/rides" element={<p>Rides page</p>} />
      </Routes>
    </NavigationProvider>
  )
}

let geo: FakeGeo
let routeMode: string

function setup({ strict = false, route = '/navigation' } = {}) {
  geo = installFakeGeolocation()
  routeMode = 'foot'
  const api = mockApi({
    'GET /settings': DEFAULT_SETTINGS,
    'GET /nav/bounds': BOUNDS,
    'GET /nav/route': (_b: unknown, u: URL) => makeRoute((routeMode || u.searchParams.get('mode')) as 'foot', GANDHIPURAM, RACE_COURSE),
    'GET /nav/reverse': { label: 'Race Course Road, Coimbatore' },
    'POST /events': { id: 1 },
  })
  const view = renderApp(strict ? <StrictMode><Layout /></StrictMode> : <Layout />, { route, mode: 'live' })
  return { api, ...view }
}

const events = (api: ReturnType<typeof mockApi>) => api.callsTo('POST', '/events').map((c) => c.body as Record<string, unknown>)

async function chooseDestination(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Choose destination on map' }))
  await user.click(screen.getByRole('button', { name: 'map click: Race Course' }))
}

async function startTrip(opts: { strict?: boolean; carMode?: boolean } = {}) {
  const user = userEvent.setup()
  const ctx = setup({ strict: opts.strict })
  act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
  await chooseDestination(user)
  if (opts.carMode) await user.click(screen.getByRole('radio', { name: 'Car' }))
  await screen.findByText(/km$/, { selector: 'dd' })
  await user.click(screen.getByRole('button', { name: 'Start navigation' }))
  await screen.findByRole('button', { name: 'Stop navigation' })
  await waitFor(() => expect(speech.speak).toHaveBeenCalled())
  return { user, ...ctx }
}

const settle = (ms: number) => act(async () => new Promise<void>((r) => setTimeout(r, ms)))
const spoken = (text: string) => speech.speak.mock.calls.filter((c) => c[0] === text).length

beforeEach(() => {
  navigationController.reset()
  speech.speak.mockClear()
  speech.cancel.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('NavigationProvider: a trip outlives the page', () => {
  it('keeps navigating on other pages, shows the in-progress bar, and Stop in the bar ends it', async () => {
    const { user, api } = await startTrip()
    await waitFor(() => expect(events(api)).toHaveLength(1))
    expect(screen.queryByRole('region', { name: 'Navigation in progress' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'go rides' }))
    expect(screen.getByText('Rides page')).toBeInTheDocument()
    const bar = screen.getByRole('region', { name: 'Navigation in progress' })
    expect(bar).toHaveTextContent(/Navigation in progress — .+ left/)
    expect(events(api)).toHaveLength(1) // leaving the page did not stop the trip
    expect(navigationController.getState().navigating).toBe(true)
    expect(geo.clearWatch).not.toHaveBeenCalled() // GPS stays on while the trip runs

    // progress continues while on another page
    act(() => geo.emit(PTS[5].lat + 0.0001, PTS[5].lon + 0.00004))
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith('Turn left onto Race Course Road', { interrupt: true }))

    await user.click(screen.getByRole('link', { name: 'Open' }))
    expect(screen.getByRole('button', { name: 'Stop navigation' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Navigation in progress' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'go rides' }))
    await user.click(within(screen.getByRole('region', { name: 'Navigation in progress' })).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(events(api)).toHaveLength(2))
    expect(events(api)[1]).toMatchObject({ status: 'stopped', source: 'live' })
    expect(screen.queryByRole('region', { name: 'Navigation in progress' })).not.toBeInTheDocument()
    expect(navigationController.getState().navigating).toBe(false)
  })

  it('does not watch GPS on other pages unless a trip is running', async () => {
    const user = userEvent.setup()
    setup({ route: '/rides' })
    expect(geo.watchPosition).not.toHaveBeenCalled()
    await user.click(screen.getByRole('link', { name: 'go nav' }))
    expect(geo.watchPosition).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('link', { name: 'go rides' }))
    expect(geo.clearWatch).toHaveBeenCalled()
  })

  it('is safe under StrictMode double mounting: one start event, one stop event', async () => {
    const { user, api } = await startTrip({ strict: true })
    await waitFor(() => expect(events(api)).toHaveLength(1))
    expect(events(api)[0]).toMatchObject({ status: 'started' })
    await user.click(screen.getByRole('button', { name: 'Stop navigation' }))
    await waitFor(() => expect(events(api)).toHaveLength(2))
    expect(events(api).map((e) => e.status)).toEqual(['started', 'stopped'])
  })

  it('switching between Live and Simulation ends the trip and logs it under the mode it ran in', async () => {
    const { user, api } = await startTrip()
    await waitFor(() => expect(events(api)).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'switch to simulation' }))
    await waitFor(() => expect(events(api)).toHaveLength(2))
    expect(events(api)[1]).toMatchObject({ status: 'stopped', source: 'live' })
    expect(navigationController.getState().navigating).toBe(false)
    expect(screen.getByText(/SIMULATION MODE/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start navigation' })).toBeDisabled()
  })

  it('the voice assistant can start a trip from another page through the controller', async () => {
    const { api } = setup({ route: '/rides' })
    expect(geo.watchPosition).not.toHaveBeenCalled()
    act(() => {
      navigationController.setDestination({ ...RACE_COURSE, label: 'Race Course' })
      navigationController.start()
    })
    // starting a trip switches the GPS on; the first fix lets the route be planned and the trip begin
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalledTimes(1))
    act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
    expect(await screen.findByRole('region', { name: 'Navigation in progress' })).toBeInTheDocument()
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith('Head south on Avinashi Road', { interrupt: true }))
    expect(api.callsTo('GET', '/nav/route')).toHaveLength(1)
  })
})

describe('Navigation: GPS accuracy', () => {
  it('a 200 m-inaccurate fix far off the route is not counted towards rerouting', async () => {
    const { api } = await startTrip()
    const off = (acc: number) => geo.emit(PTS[2].lat, PTS[2].lon + 0.0018, acc) // about 200 m east of the route
    act(() => off(10))
    act(() => off(10))
    act(() => off(200)) // would be the third, but it is too imprecise to count
    expect(await screen.findByText(/Low GPS accuracy/)).toBeInTheDocument()
    expect(spoken('Rerouting.')).toBe(0)
    expect(api.callsTo('GET', '/nav/route')).toHaveLength(1)
    act(() => off(10)) // a good fix is the third that counts
    await waitFor(() => expect(spoken('Rerouting.')).toBe(1))
    expect(screen.queryByText(/Low GPS accuracy/)).not.toBeInTheDocument()
  })

  it('an imprecise fix at the destination does not trigger arrival; a good one does', async () => {
    await startTrip()
    act(() => geo.emit(PTS[10].lat, PTS[10].lon, 200))
    expect(await screen.findByText(/Low GPS accuracy/)).toBeInTheDocument()
    expect(spoken('You have arrived.')).toBe(0)
    expect(screen.getByRole('button', { name: 'Stop navigation' })).toBeInTheDocument()
    act(() => geo.emit(PTS[10].lat, PTS[10].lon, 8))
    await waitFor(() => expect(spoken('You have arrived.')).toBe(1))
  })
})

describe('Navigation: guidance details', () => {
  it('warns earlier by car (120 m) than on foot (40 m)', async () => {
    await startTrip({ carMode: true })
    // about 100 m before the turn
    act(() => geo.emit(PTS[5].lat + 0.0009, PTS[5].lon + 0.00036))
    await waitFor(() => expect(spoken('Turn left onto Race Course Road')).toBe(1))
  })

  it('does not warn 100 m ahead when walking', async () => {
    await startTrip()
    act(() => geo.emit(PTS[5].lat + 0.0009, PTS[5].lon + 0.00036))
    await settle(100)
    expect(spoken('Turn left onto Race Course Road')).toBe(0)
  })

  it('progress never goes backwards because of GPS jitter', async () => {
    await startTrip()
    const stepNow = () => screen.getByRole('list', { name: 'Directions' }).querySelector('[aria-current="step"]')
    act(() => geo.emit(PTS[6].lat, PTS[6].lon))
    await waitFor(() => expect(stepNow()).toHaveTextContent('Turn left onto Race Course Road'))
    act(() => geo.emit(PTS[3].lat, PTS[3].lon)) // jitter back along the road
    await act(async () => undefined)
    expect(stepNow()).toHaveTextContent('Turn left onto Race Course Road')
  })
})

describe('Navigation: GPS signal lost (no fix for a while)', () => {
  const original = { ...navTiming }
  beforeEach(() => Object.assign(navTiming, { staleMs: 600, checkMs: 40, movedRecentMs: 1500 }))
  afterEach(() => Object.assign(navTiming, original))

  it('says and shows it when a moving person stops getting fixes, and recovers on the next fix', async () => {
    await startTrip()
    act(() => geo.emit(PTS[3].lat, PTS[3].lon)) // moved
    expect(await screen.findByText(/GPS signal lost\. Navigation is paused/, undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(spoken('GPS signal lost.')).toBe(1)
    act(() => geo.emit(PTS[4].lat, PTS[4].lon))
    await waitFor(() => expect(screen.queryByText(/GPS signal lost\. Navigation is paused/)).not.toBeInTheDocument())
  })

  it('shows but does not speak it when the person has not been moving', async () => {
    await startTrip()
    // fixes keep arriving from the same spot for longer than the "moved recently" window, then stop
    for (let i = 0; i < 20; i++) {
      act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
      await settle(100)
    }
    expect(await screen.findByText(/GPS signal lost\. Navigation is paused/, undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(spoken('GPS signal lost.')).toBe(0)
  })

  it('a quick timeout error from the watch alone is not "signal lost"', async () => {
    navTiming.staleMs = 10_000
    await startTrip()
    act(() => geo.fail(3))
    await settle(150)
    expect(screen.queryByText(/GPS signal lost\. Navigation is paused/)).not.toBeInTheDocument()
  })
})
