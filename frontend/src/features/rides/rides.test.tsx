import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mode } from '../../lib/mode'
import { fail, mockApi } from '../../test-api'
import { installFakeGeolocation, type FakeGeo } from '../../test-geo'
import { makeRoute } from '../../test-routes'
import { renderApp } from '../../test-utils'
import type { Ride } from './api'

vi.mock('../maps/MapView', async () => import('../../test-map'))

import { RidesPage } from './RidesPage'

const GANDHIPURAM = { lat: 11.0183, lon: 76.9725 }
const RACE_COURSE = { lat: 11.001, lon: 76.966 }
const DISCLAIMER = 'Third Eye ride request (demo). No driver is assigned and no real ride is booked.'
const SERVER_DISCLAIMER = 'This is a Third Eye ride request (demo). No driver has been assigned and no real ride has been booked.'
const DURATION: Record<string, number> = { foot: 1500, car: 420, bike: 600 }

function ride(over: Partial<Ride> = {}): Ride {
  return {
    id: 1,
    booking_id: 'TE-20261030-0001',
    pickup: { ...GANDHIPURAM, label: 'Gandhipuram' },
    destination: { ...RACE_COURSE, label: 'Race Course' },
    mode: 'car',
    distance_m: 2100,
    duration_s: 420,
    fare_estimate: 59,
    fare_note: 'Estimate using demo rates — not a real fare.',
    status: 'requested',
    created_at: '2026-10-30T10:00:00Z',
    disclaimer: SERVER_DISCLAIMER,
    ...over,
  }
}

let geo: FakeGeo
let rides: Ride[]
let postHandler: (body: unknown) => unknown
let cancelHandler: (id: string) => unknown

function setup(mode: Mode = 'live', extra: Record<string, unknown> = {}, initial: Ride[] = []) {
  geo = installFakeGeolocation()
  rides = initial
  postHandler = () => ({ __status: 201, body: ride() })
  cancelHandler = () => ({ ...rides[0], status: 'cancelled' })
  const api = mockApi({
    'GET /nav/bounds': {
      bounds: { south: 10.85, west: 76.85, north: 11.15, east: 77.15 },
      centre: { lat: 11.0168, lon: 76.9558 },
      message: 'Third Eye navigation is currently limited to Coimbatore, Tamil Nadu. Please choose a place inside the Coimbatore service area.',
    },
    'GET /nav/route': (_b: unknown, u: URL) => {
      const m = u.searchParams.get('mode') as 'foot'
      return makeRoute(m, GANDHIPURAM, RACE_COURSE, { distance_m: 2100, duration_s: DURATION[m] })
    },
    'GET /nav/reverse': (_b: unknown, u: URL) => ({ label: Number(u.searchParams.get('lat')) > 11.01 ? 'Gandhipuram' : 'Race Course' }),
    'GET /rides': () => ({ items: rides, total: rides.length, limit: 50, offset: 0 }),
    'POST /rides': (b: unknown) => postHandler(b),
    'POST /rides/1/cancel': () => cancelHandler('1'),
    ...extra,
  })
  const view = renderApp(<RidesPage />, { route: '/rides', mode })
  return { api, ...view }
}

type User = ReturnType<typeof userEvent.setup>
async function pick(user: User, field: 'pickup' | 'destination', spot: string) {
  await user.click(screen.getByRole('button', { name: `Choose ${field} on map` }))
  await user.click(screen.getByRole('button', { name: `map click: ${spot}` }))
}
async function planTrip(user: User) {
  await pick(user, 'pickup', 'Gandhipuram')
  await pick(user, 'destination', 'Race Course')
  await screen.findAllByText('2.1 km', { selector: 'span' }) // route cards filled in
}

afterEach(() => vi.unstubAllGlobals())

describe('Book a Ride', () => {
  it('always shows the demo disclaimer, with no driver claims', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm ride request' })).toBeDisabled()
    await planTrip(user)
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument()
    expect(screen.queryByText(/driver (is|will be) (arriving|on the way)/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/driver arrives in/i)).not.toBeInTheDocument()
  })

  it('blocks a pickup or destination outside Coimbatore before any request is made', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await pick(user, 'pickup', 'Bengaluru')
    expect(await screen.findByText(/limited to Coimbatore, Tamil Nadu/)).toBeInTheDocument()
    await pick(user, 'destination', 'Bengaluru')
    expect(screen.getAllByText(/limited to Coimbatore, Tamil Nadu/).length).toBe(2)
    expect(api.callsTo('GET', '/nav/route')).toHaveLength(0)
    expect(api.callsTo('POST', '/rides')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Confirm ride request' })).toBeDisabled()
  })

  it('shows distance and time for each ride type and the fare note, without inventing a fare', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await planTrip(user)
    await waitFor(() => expect(api.callsTo('GET', '/nav/route')).toHaveLength(3))
    const modes = api.callsTo('GET', '/nav/route').map((c) => new URLSearchParams(c.search).get('mode'))
    expect(modes.sort()).toEqual(['bike', 'car', 'foot'])
    await screen.findByText('about 7 min')
    expect(screen.getByText('about 10 min')).toBeInTheDocument()
    expect(screen.getByText('about 25 min')).toBeInTheDocument()
    expect(screen.getByText(/Fare is calculated when you confirm — estimate using demo rates/)).toBeInTheDocument()
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument()
  })

  it('confirms a walking request with the walk mode and numbers from the route; walking shows no fare', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    postHandler = () => ({ __status: 201, body: ride({ mode: 'walk', duration_s: 1500, fare_estimate: null, fare_note: null }) })
    await planTrip(user)
    await user.click(screen.getByRole('radio', { name: /Walking/ }))
    expect(screen.getByText(/Walking has no fare\./)).toBeInTheDocument()
    expect(screen.getByText('No fare for walking', { selector: 'dd' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm ride request' }))

    await screen.findByText('Ride request recorded')
    expect(api.callsTo('POST', '/rides')[0].body).toEqual({
      pickup: { lat: 11.0183, lon: 76.9725, label: 'Gandhipuram' },
      destination: { lat: 11.001, lon: 76.966, label: 'Race Course' },
      mode: 'walk',
      distance_m: 2100,
      duration_s: 1500,
    })
    expect(screen.getByText('TE-20261030-0001')).toBeInTheDocument()
    expect(screen.getByText('Requested', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getAllByText('No fare for walking').length).toBeGreaterThan(0)
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument()
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument()
    expect(screen.getAllByText(SERVER_DISCLAIMER).length).toBeGreaterThan(0)
  })

  it('shows the fare the server calculated for a car request', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await planTrip(user)
    await user.click(screen.getByRole('button', { name: 'Confirm ride request' }))
    await screen.findByText('Ride request recorded')
    expect(api.callsTo('POST', '/rides')[0].body).toMatchObject({ mode: 'car', duration_s: 420 })
    expect(screen.getByText(/Fare estimate ₹59/)).toBeInTheDocument()
    expect(screen.getByText(/Estimate using demo rates/)).toBeInTheDocument()
  })

  it.each([
    [200, 'an identical request the server recognises'],
    [201, 'a new request'],
  ])('treats HTTP %i (%s) as success', async (status) => {
    const user = userEvent.setup()
    setup()
    postHandler = () => ({ __status: status, body: ride() })
    await planTrip(user)
    await user.click(screen.getByRole('button', { name: 'Confirm ride request' }))
    expect(await screen.findByText('Ride request recorded')).toBeInTheDocument()
    expect(screen.queryByText(/could not be sent/)).not.toBeInTheDocument()
  })

  it('shows the server message when the request is rejected (422)', async () => {
    const user = userEvent.setup()
    setup()
    postHandler = () => fail(422, 'distance does not match the route')
    await planTrip(user)
    await user.click(screen.getByRole('button', { name: 'Confirm ride request' }))
    expect(await screen.findByText('distance does not match the route')).toBeInTheDocument()
    expect(screen.queryByText('Ride request recorded')).not.toBeInTheDocument()
  })

  it('refuses a pickup and destination that are less than 50 m apart', async () => {
    const user = userEvent.setup()
    setup()
    await pick(user, 'pickup', 'Gandhipuram')
    await pick(user, 'destination', 'Gandhipuram')
    expect(await screen.findByText(/at least 50 metres apart/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm ride request' })).toBeDisabled()
  })

  it('reports a ride type with no route (bicycle) on its own card and keeps the others usable', async () => {
    const user = userEvent.setup()
    setup('live', {
      'GET /nav/route': (_b: unknown, u: URL) =>
        u.searchParams.get('mode') === 'bike'
          ? fail(404, 'Bicycle routing is not available for this trip')
          : makeRoute('car', GANDHIPURAM, RACE_COURSE),
    })
    await planTrip(user)
    expect(await screen.findByText('Bicycle routing is not available for this trip')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Bike/ }))
    expect(screen.getByRole('button', { name: 'Confirm ride request' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /Car/ }))
    expect(screen.getByRole('button', { name: 'Confirm ride request' })).toBeEnabled()
  })
})

describe('Book a Ride: pickup from the current location', () => {
  it('uses the device position when it is inside Coimbatore', async () => {
    const user = userEvent.setup()
    setup()
    geo.getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok({ coords: { latitude: 11.0183, longitude: 76.9725, accuracy: 9 }, timestamp: 1 } as GeolocationPosition),
    )
    await user.click(screen.getByRole('button', { name: 'Use current location' }))
    expect(await screen.findByText('Gandhipuram', { selector: 'span.font-semibold' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Pickup' })).toHaveValue('Gandhipuram')
  })

  it('explains a denied permission and keeps the other ways to choose', async () => {
    const user = userEvent.setup()
    setup()
    geo.getCurrentPosition.mockImplementation((_ok: PositionCallback, err: PositionErrorCallback) => err({ code: 1 } as GeolocationPositionError))
    await user.click(screen.getByRole('button', { name: 'Use current location' }))
    expect(await screen.findByText(/Location permission was denied/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose pickup on map' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Enter coordinates', expanded: false })[0]).toBeInTheDocument()
  })

  it('refuses a device position outside the service area', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    geo.getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok({ coords: { latitude: 12.97, longitude: 77.59, accuracy: 9 }, timestamp: 1 } as GeolocationPosition),
    )
    await user.click(screen.getByRole('button', { name: 'Use current location' }))
    expect(await screen.findByText(/limited to Coimbatore, Tamil Nadu/)).toBeInTheDocument()
    expect(api.callsTo('GET', '/nav/route')).toHaveLength(0)
  })

  it('Simulation mode never reads the device GPS and offers a sample pickup', async () => {
    const user = userEvent.setup()
    setup('simulation')
    expect(screen.getByText(/SIMULATION MODE/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use current location' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use sample pickup (Gandhipuram)' }))
    expect(screen.getByRole('combobox', { name: 'Pickup' })).toHaveValue('Gandhipuram, Coimbatore (sample pickup)')
    expect(geo.getCurrentPosition).not.toHaveBeenCalled()
    expect(geo.watchPosition).not.toHaveBeenCalled()
  })
})

describe('Ride history and cancelling', () => {
  it('shows an empty state, then lists requests with status badges', async () => {
    setup()
    expect(await screen.findByText('No ride requests yet')).toBeInTheDocument()
  })

  it('lists rides, offers Cancel only for requested ones, and cancels after confirmation', async () => {
    const user = userEvent.setup()
    const { api } = setup('live', {}, [ride(), ride({ id: 2, booking_id: 'TE-20261030-0002', status: 'cancelled' })])
    const list = await screen.findByRole('list', { name: 'Ride requests' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Requested')).toBeInTheDocument()
    expect(within(items[1]).getByText('Cancelled')).toBeInTheDocument()
    expect(within(items[0]).getByRole('button', { name: 'Cancel ride request TE-20261030-0001' })).toBeInTheDocument()
    expect(within(items[1]).queryByRole('button')).not.toBeInTheDocument()
    expect(within(items[0]).getByText(SERVER_DISCLAIMER, { exact: false })).toBeInTheDocument()

    await user.click(within(items[0]).getByRole('button', { name: /Cancel ride request/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this ride request?' })
    // nothing is cancelled until it is confirmed
    expect(api.callsTo('POST', '/rides/1/cancel')).toHaveLength(0)
    rides = [ride({ status: 'cancelled' }), rides[1]]
    await user.click(within(dialog).getByRole('button', { name: 'Yes, cancel request' }))
    await waitFor(() => expect(api.callsTo('POST', '/rides/1/cancel')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('button', { name: /Cancel ride request/ })).not.toBeInTheDocument())
  })

  it('keeping the request closes the dialog without calling the server', async () => {
    const user = userEvent.setup()
    const { api } = setup('live', {}, [ride()])
    await user.click(await screen.findByRole('button', { name: /Cancel ride request/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep request' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.callsTo('POST', '/rides/1/cancel')).toHaveLength(0)
  })

  it('handles 409 gracefully: explains, refreshes the list, keeps the dialog usable', async () => {
    const user = userEvent.setup()
    const { api } = setup('live', {}, [ride()])
    cancelHandler = () => fail(409, 'Only requested rides can be cancelled')
    await user.click(await screen.findByRole('button', { name: /Cancel ride request/ }))
    const dialog = await screen.findByRole('dialog')
    const before = api.callsTo('GET', '/rides').length
    rides = [ride({ status: 'cancelled' })]
    await user.click(within(dialog).getByRole('button', { name: 'Yes, cancel request' }))
    expect(await within(dialog).findByText(/can no longer be cancelled/)).toBeInTheDocument()
    await waitFor(() => expect(api.callsTo('GET', '/rides').length).toBeGreaterThan(before))
    await user.click(within(dialog).getByRole('button', { name: 'Keep request' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Cancel ride request/ })).not.toBeInTheDocument())
  })

  it('shows an error state with a retry when the list cannot be loaded', async () => {
    const user = userEvent.setup()
    setup('live', { 'GET /rides': fail(500, 'boom') })
    expect(await screen.findByText('boom')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('a new request appears in the history after it is confirmed', async () => {
    const user = userEvent.setup()
    setup()
    postHandler = () => {
      rides = [ride()]
      return { __status: 201, body: ride() }
    }
    await planTrip(user)
    await user.click(screen.getByRole('button', { name: 'Confirm ride request' }))
    const list = await screen.findByRole('list', { name: 'Ride requests' })
    expect(within(list).getByText('TE-20261030-0001')).toBeInTheDocument()
    await act(async () => undefined)
  })
})
