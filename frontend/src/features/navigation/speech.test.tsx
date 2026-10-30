import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mockApi } from '../../test-api'
import { installFakeGeolocation, type FakeGeo } from '../../test-geo'
import { makeRoute, routePoints } from '../../test-routes'
import { renderApp } from '../../test-utils'
import { navigationController } from './controller'

// The REAL useSpeech runs here, over a fake speechSynthesis that records what the browser would be told to do.
vi.mock('../maps/MapView', async () => import('../../test-map'))

import { NavigationPage } from './NavigationPage'
import { NavigationProvider } from './NavigationProvider'

const GANDHIPURAM = { lat: 11.0183, lon: 76.9725 }
const RACE_COURSE = { lat: 11.001, lon: 76.966 }
const PTS = routePoints(makeRoute('foot', GANDHIPURAM, RACE_COURSE))

type Utt = { text: string; onend?: () => void; onstart?: () => void; onerror?: () => void }
let log: Array<['speak', string] | ['cancel']>
let utterances: Utt[]
let synth: { speaking: boolean; speak: (u: Utt) => void; cancel: () => void; getVoices: () => unknown[] }
let geo: FakeGeo
let routeCalls: number
let gate: Promise<void> | null

function installSpeech() {
  log = []
  utterances = []
  synth = {
    speaking: false,
    speak(u) {
      log.push(['speak', u.text])
      utterances.push(u)
      this.speaking = true
    },
    cancel() {
      log.push(['cancel'])
      this.speaking = false
    },
    getVoices: () => [],
  }
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string
      rate = 1
      voice: unknown = null
      constructor(t: string) {
        this.text = t
      }
    },
  )
}

/** Marks the most recent utterance as finished, as the browser does when it stops talking. */
function finishSpeaking() {
  const u = utterances.at(-1)
  synth.speaking = false
  act(() => u?.onend?.())
}

async function setup() {
  installSpeech()
  geo = installFakeGeolocation()
  routeCalls = 0
  gate = null
  const api = mockApi({
    'GET /settings': DEFAULT_SETTINGS,
    'GET /nav/bounds': {
      bounds: { south: 10.85, west: 76.85, north: 11.15, east: 77.15 },
      centre: { lat: 11.0168, lon: 76.9558 },
      message: 'Third Eye navigation is currently limited to Coimbatore, Tamil Nadu. Please choose a place inside the Coimbatore service area.',
    },
    'GET /nav/route': async () => {
      routeCalls++
      const r = makeRoute('foot', GANDHIPURAM, RACE_COURSE)
      if (routeCalls > 1) {
        r.steps[0].instruction = 'Head north on New Road'
        await gate
      }
      return r
    },
    'GET /nav/reverse': { label: 'Race Course Road, Coimbatore' },
    'POST /events': { id: 1 },
  })
  renderApp(
    <NavigationProvider>
      <NavigationPage />
    </NavigationProvider>,
    { route: '/navigation', mode: 'live' },
  )
  const user = userEvent.setup()
  act(() => geo.emit(GANDHIPURAM.lat, GANDHIPURAM.lon))
  await user.click(screen.getByRole('button', { name: 'Choose destination on map' }))
  await user.click(screen.getByRole('button', { name: 'map click: Race Course' }))
  await screen.findByText('Turn-by-turn directions')
  // spoken guidance needs the settings document to have loaded
  await waitFor(() => expect(api.callsTo('GET', '/settings').length).toBeGreaterThan(0))
  await act(async () => new Promise((r) => setTimeout(r, 50)))
  await user.click(screen.getByRole('button', { name: 'Start navigation' }))
  await waitFor(() => expect(log).toContainEqual(['speak', 'Head south on Avinashi Road']))
  return { user, api }
}

beforeEach(() => navigationController.reset())
afterEach(() => vi.unstubAllGlobals())

describe('Navigation speech through the real useSpeech', () => {
  it('"You have arrived." is never cancelled by the trip ending', async () => {
    await setup()
    act(() => geo.emit(PTS[10].lat, PTS[10].lon))
    await waitFor(() => expect(log).toContainEqual(['speak', 'You have arrived.']))
    await screen.findByRole('button', { name: 'Start navigation' }) // the trip has ended
    const arrivedAt = log.findIndex((e) => e[0] === 'speak' && e[1] === 'You have arrived.')
    expect(log.slice(arrivedAt + 1)).toEqual([]) // nothing, in particular no cancel, after it
    expect(synth.speaking).toBe(true) // the utterance is still playing
  })

  it('"Rerouting." is not cut off by the new route\'s first instruction (dropped while it is still playing)', async () => {
    await setup()
    const off = () => geo.emit(PTS[2].lat, PTS[2].lon + 0.0018, 10)
    act(() => off())
    act(() => off())
    act(() => off())
    await waitFor(() => expect(log).toContainEqual(['speak', 'Rerouting.']))
    await waitFor(() => expect(routeCalls).toBe(2))
    await screen.findByText('Head north on New Road', { selector: 'p' }) // shown on screen
    const at = log.findIndex((e) => e[0] === 'speak' && e[1] === 'Rerouting.')
    expect(log.slice(at + 1).some((e) => e[0] === 'cancel')).toBe(false)
    expect(log.slice(at + 1).some((e) => e[0] === 'speak')).toBe(false)
  })

  it('"Rerouting." is also not cancelled when the new instruction arrives after it finished: it is simply spoken', async () => {
    await setup()
    let release: () => void = () => undefined
    gate = new Promise<void>((r) => (release = r))
    const off = () => geo.emit(PTS[2].lat, PTS[2].lon + 0.0018, 10)
    act(() => off())
    act(() => off())
    act(() => off())
    await waitFor(() => expect(log).toContainEqual(['speak', 'Rerouting.']))
    finishSpeaking() // "Rerouting." has been said in full
    release()
    await waitFor(() => expect(log).toContainEqual(['speak', 'Head north on New Road']))
    const at = log.findIndex((e) => e[0] === 'speak' && e[1] === 'Rerouting.')
    expect(log.slice(at + 1)).toEqual([['speak', 'Head north on New Road']])
  })
})
