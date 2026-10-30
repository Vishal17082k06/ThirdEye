import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '../devices/useDevices'
import { CONFIRM_TIMEOUT_MS, createExecutor, describeDevices, readScreen, shortLabel, type ExecutorDeps, type Reply } from './executor'

const GANDHIPURAM = { label: 'Gandhipuram, Coimbatore, Tamil Nadu, India', lat: 11.0183, lon: 76.9725, kind: 'suburb' }
const RS_PURAM = { label: 'RS Puram, Coimbatore, Tamil Nadu, India', lat: 11.0069, lon: 76.9503, kind: 'suburb' }
const PEELAMEDU = { label: 'Peelamedu, Coimbatore, Tamil Nadu, India', lat: 11.0296, lon: 77.0237, kind: 'suburb' }
const CHENNAI = { label: 'Gandhipuram, Chennai', lat: 13.08, lon: 80.27, kind: 'suburb' }

function dev(key: string, name: string, status: Device['status'], error: string | null = null): Device {
  return { key: key as Device['key'], name, status, last_seen: null, config: {}, error }
}

function makeDeps(over: Partial<ExecutorDeps> = {}) {
  const deps: ExecutorDeps = {
    navigate: vi.fn(),
    ai: {
      request: vi.fn(async () => ({ ok: true, message: 'The camera is on.' })),
      state: vi.fn(() => ({ mounted: true, camera: 'idle' as const, detecting: false, gesturePrompt: null })),
    },
    nav: {
      setDestination: vi.fn(() => ({ ok: true })),
      setMode: vi.fn(),
      start: vi.fn(() => ({ ok: true })),
      getState: vi.fn(() => ({ destination: null, mode: 'foot' as const, navigating: false, position: null })),
    },
    whereAmI: vi.fn(async () => 'You are near Gandhipuram.'),
    geocode: vi.fn(async () => [GANDHIPURAM]),
    getDevices: vi.fn(async () => [dev('laptop_camera', 'Laptop/USB Camera', 'connected')]),
    geoPermission: vi.fn(async () => 'granted' as const),
    simulation: false,
    getGuardian: vi.fn(async () => ({ name: 'Meera', phone: '+91 98765 43210' })),
    sos: { live: true, ready: true, requestSend: vi.fn(), confirmOpen: vi.fn(() => false), confirm: vi.fn(), cancel: vi.fn() },
    readScreen: vi.fn(() => 'This is the Dashboard page.'),
    dial: vi.fn(),
    ...over,
  }
  return deps
}

function setup(over: Partial<ExecutorDeps> = {}, onExpire?: (r: Reply) => void) {
  const deps = makeDeps(over)
  const ex = createExecutor(() => deps, { onExpire })
  return { deps, ex }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('pages and back', () => {
  it.each([
    ['open dashboard', '/dashboard'],
    ['open AI assistance', '/ai'],
    ['open navigation', '/navigation'],
    ['open book a ride', '/rides'],
  ])('%s navigates to %s', async (text, path) => {
    const { deps, ex } = setup()
    const r = await ex.execute(text)
    expect(deps.navigate).toHaveBeenCalledWith(path)
    expect(r.ok).toBe(true)
  })

  it('go back navigates -1', async () => {
    const { deps, ex } = setup()
    await ex.execute('go back')
    expect(deps.navigate).toHaveBeenCalledWith(-1)
  })
})

describe('camera and detection through the AI controller', () => {
  it('start camera on another page navigates to /ai first, then requests the command', async () => {
    const { deps, ex } = setup({
      ai: { request: vi.fn(async () => ({ ok: true, message: 'The camera is on.' })), state: () => ({ mounted: false, camera: 'idle', detecting: false, gesturePrompt: null }) },
    })
    const r = await ex.execute('start camera')
    expect(deps.navigate).toHaveBeenCalledWith('/ai')
    expect(deps.ai.request).toHaveBeenCalledWith('startCamera')
    expect(r.text).toBe('The camera is on.')
  })

  it('does not navigate when the AI page is already open', async () => {
    const { deps, ex } = setup()
    await ex.execute('start obstacle detection')
    expect(deps.navigate).not.toHaveBeenCalled()
    expect(deps.ai.request).toHaveBeenCalledWith('startDetection')
  })

  it('reports the real failure when the browser blocks the camera', async () => {
    const { ex } = setup({
      ai: { request: vi.fn(async () => ({ ok: false, message: 'Camera permission was denied.' })), state: () => ({ mounted: true, camera: 'idle', detecting: false, gesturePrompt: null }) },
    })
    const r = await ex.execute('start camera')
    expect(r.ok).toBe(false)
    expect(r.text).toBe('Camera permission was denied.')
  })

  it('stop commands off the AI page say they are already off and do not navigate there', async () => {
    const { deps, ex } = setup({
      ai: { request: vi.fn(), state: () => ({ mounted: false, camera: 'idle', detecting: false, gesturePrompt: null }) },
    })
    const r = await ex.execute('stop camera')
    expect(r.text).toContain('already off')
    expect(deps.ai.request).not.toHaveBeenCalled()
    expect(deps.navigate).not.toHaveBeenCalled()
  })

  it('stop detection on the AI page goes through the controller', async () => {
    const { deps, ex } = setup()
    await ex.execute('stop obstacle detection')
    expect(deps.ai.request).toHaveBeenCalledWith('stopDetection')
  })
})

describe('where am I', () => {
  it('returns the real answer and marks it as already spoken', async () => {
    const { ex } = setup()
    const r = await ex.execute('where am I')
    expect(r.text).toBe('You are near Gandhipuram.')
    expect(r.alreadySpoken).toBe(true)
  })

  it('passes through an honest GPS failure', async () => {
    const { ex } = setup({ whereAmI: vi.fn(async () => 'GPS not available.') })
    expect((await ex.execute('where am i')).text).toBe('GPS not available.')
  })
})

describe('take me to a destination', () => {
  it('one match asks for confirmation, then sets the destination and starts', async () => {
    const { deps, ex } = setup()
    const ask = await ex.execute('take me to Gandhipuram')
    expect(deps.geocode).toHaveBeenCalledWith('gandhipuram')
    expect(ask.text).toBe('Start navigation to Gandhipuram, Coimbatore? Say yes or no.')
    expect(deps.nav.start).not.toHaveBeenCalled()

    const go = await ex.execute('yes')
    expect(deps.navigate).toHaveBeenCalledWith('/navigation')
    expect(deps.nav.setDestination).toHaveBeenCalledWith({ lat: GANDHIPURAM.lat, lon: GANDHIPURAM.lon, label: GANDHIPURAM.label })
    expect(deps.nav.start).toHaveBeenCalled()
    expect(go.text).toContain('Starting navigation to Gandhipuram, Coimbatore')
    expect(ex.hasPending()).toBe(false)
  })

  it('"no" cancels without starting', async () => {
    const { deps, ex } = setup()
    await ex.execute('take me to Gandhipuram')
    const r = await ex.execute('no')
    expect(r.text).toBe('Cancelled.')
    expect(deps.nav.setDestination).not.toHaveBeenCalled()
    expect(deps.nav.start).not.toHaveBeenCalled()
  })

  it('times out after 10 seconds with Cancelled', async () => {
    const onExpire = vi.fn()
    const { deps, ex } = setup({}, onExpire)
    await ex.execute('take me to Gandhipuram')
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS - 1)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(onExpire).toHaveBeenCalledOnce()
    expect(onExpire.mock.calls[0][0].text).toContain('Cancelled')
    expect(ex.hasPending()).toBe(false)
    expect((await ex.execute('yes')).text).toBe('There is nothing to confirm.')
    expect(deps.nav.start).not.toHaveBeenCalled()
  })

  it('an unrelated command cancels the question and runs', async () => {
    const { deps, ex } = setup()
    await ex.execute('take me to Gandhipuram')
    await ex.execute('open dashboard')
    expect(deps.navigate).toHaveBeenCalledWith('/dashboard')
    expect(ex.hasPending()).toBe(false)
    await ex.execute('yes')
    expect(deps.nav.start).not.toHaveBeenCalled()
  })

  it('reads the top three matches and lets the person pick by number', async () => {
    const { deps, ex } = setup({ geocode: vi.fn(async () => [GANDHIPURAM, RS_PURAM, PEELAMEDU, { ...GANDHIPURAM, label: 'Fourth, Coimbatore' }]) })
    const list = await ex.execute('navigate to puram')
    expect(list.text).toContain('I found 3 places')
    expect(list.text).toContain('2, RS Puram, Coimbatore')
    expect(list.text).not.toContain('Fourth')
    expect(list.text).toContain('Say the number')

    const confirm = await ex.execute('number 2')
    expect(confirm.text).toBe('Start navigation to RS Puram, Coimbatore? Say yes or no.')
    await ex.execute('yes')
    expect(deps.nav.setDestination).toHaveBeenCalledWith(expect.objectContaining({ label: RS_PURAM.label }))
  })

  it('rejects a number outside the list and keeps asking; "cancel" ends it', async () => {
    const { deps, ex } = setup({ geocode: vi.fn(async () => [GANDHIPURAM, RS_PURAM]) })
    await ex.execute('go to puram')
    const r = await ex.execute('three')
    expect(r.text).toContain('only 2 options')
    expect(ex.hasPending()).toBe(true)
    expect((await ex.execute('cancel')).text).toBe('Cancelled.')
    expect(deps.nav.start).not.toHaveBeenCalled()
  })

  it('says honestly when nothing is found inside Coimbatore', async () => {
    const { deps, ex } = setup({ geocode: vi.fn(async () => [CHENNAI]) })
    const r = await ex.execute('take me to Marina Beach')
    expect(r.text).toBe("I couldn't find marina beach inside Coimbatore.")
    expect(r.ok).toBe(false)
    expect(deps.nav.start).not.toHaveBeenCalled()
  })

  it('says so when there are no results at all, and when search fails', async () => {
    const empty = setup({ geocode: vi.fn(async () => []) })
    expect((await empty.ex.execute('take me to nowhere land')).text).toContain("couldn't find nowhere land inside Coimbatore")
    const failing = setup({ geocode: vi.fn(async () => { throw new Error('Search is unavailable.') }) })
    const r = await failing.ex.execute('take me to Gandhipuram')
    expect(r.ok).toBe(false)
    expect(r.text).toContain('could not search')
    expect(r.text).toContain('Search is unavailable.')
  })

  it('"take me to a destination" asks where, and the next utterance is the destination', async () => {
    const { deps, ex } = setup()
    const q = await ex.execute('take me to a destination')
    expect(q.text).toBe('Where would you like to go?')
    expect(deps.geocode).not.toHaveBeenCalled()
    const r = await ex.execute('Peelamedu')
    expect(deps.geocode).toHaveBeenCalledWith('Peelamedu')
    expect(r.text).toContain('Start navigation to')
  })

  it('reports a refused destination honestly', async () => {
    const { ex } = setup({
      nav: {
        setDestination: vi.fn(() => ({ ok: false, message: 'Outside the service area.' })),
        setMode: vi.fn(),
        start: vi.fn(() => ({ ok: true })),
        getState: vi.fn(() => ({ destination: null, mode: 'foot' as const, navigating: false, position: null })),
      },
    })
    await ex.execute('take me to Gandhipuram')
    const r = await ex.execute('yes')
    expect(r.ok).toBe(false)
    expect(r.text).toBe('Outside the service area.')
  })
})

describe('travel mode', () => {
  it('walking mode sets foot; car mode sets car', async () => {
    const { deps, ex } = setup()
    await ex.execute('walking mode')
    expect(deps.nav.setMode).toHaveBeenLastCalledWith('foot')
    const r = await ex.execute('car mode')
    expect(deps.nav.setMode).toHaveBeenLastCalledWith('car')
    expect(r.text).toBe('Car mode selected.')
  })

  it('mentions re-planning only when a destination exists', async () => {
    const { ex } = setup({
      nav: {
        setDestination: vi.fn(() => ({ ok: true })),
        setMode: vi.fn(),
        start: vi.fn(() => ({ ok: true })),
        getState: vi.fn(() => ({ destination: { lat: 11, lon: 77, label: 'Gandhipuram, Coimbatore' }, mode: 'foot' as const, navigating: true, position: null })),
      },
    })
    expect((await ex.execute('car mode')).text).toContain('re-planned')
  })
})

describe('device status honesty', () => {
  it('reads every real status, including not integrated and disconnected', async () => {
    const { ex } = setup({
      getDevices: vi.fn(async () => [
        dev('vl53l0x', 'Distance sensor', 'disconnected'),
        dev('esp32_cam', 'ESP32-CAM', 'not_integrated'),
        dev('laptop_camera', 'Laptop/USB Camera', 'error', 'Camera is in use'),
      ]),
      geoPermission: vi.fn(async () => 'denied' as const),
    })
    const r = await ex.execute('check device status')
    expect(r.text).toContain('Distance sensor: disconnected')
    expect(r.text).toContain('ESP32-CAM: not integrated yet')
    expect(r.text).toContain('Laptop/USB Camera: error (Camera is in use)')
    expect(r.text).toContain('Location permission: blocked')
    expect(r.text).not.toContain('Simulation')
  })

  it('says simulated tools do not change real status in Simulation mode', async () => {
    const { ex } = setup({ simulation: true })
    expect((await ex.execute('device status')).text).toContain('simulated tools do not change real device status')
  })

  it('reports failure to load rather than inventing statuses', async () => {
    const { ex } = setup({ getDevices: vi.fn(async () => { throw new Error('Server unreachable.') }) })
    const r = await ex.execute('device status')
    expect(r.ok).toBe(false)
    expect(r.text).toContain('could not load the device status')
  })

  it('describeDevices handles an empty list', () => {
    expect(describeDevices([], 'unknown', false)).toContain('no devices')
  })
})

describe('call guardian needs confirmation', () => {
  it('asks first and only dials after yes', async () => {
    const { deps, ex } = setup()
    const q = await ex.execute('call my guardian')
    expect(q.text).toBe('Call Meera on +91 98765 43210? Say yes or no.')
    expect(deps.dial).not.toHaveBeenCalled()
    const r = await ex.execute('yes')
    expect(deps.dial).toHaveBeenCalledWith('tel:+919876543210')
    expect(r.text).toContain('depends on your device')
  })

  it('does not dial on no, on timeout, or when interrupted', async () => {
    const a = setup()
    await a.ex.execute('call guardian')
    await a.ex.execute('no')
    expect(a.deps.dial).not.toHaveBeenCalled()

    const b = setup()
    await b.ex.execute('call guardian')
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS + 1)
    await b.ex.execute('yes')
    expect(b.deps.dial).not.toHaveBeenCalled()

    const c = setup()
    await c.ex.execute('call guardian')
    await c.ex.execute('open dashboard')
    await c.ex.execute('yes')
    expect(c.deps.dial).not.toHaveBeenCalled()
  })

  it('is honest when no guardian phone is saved, and in Simulation mode', async () => {
    const none = setup({ getGuardian: vi.fn(async () => null) })
    const r = await none.ex.execute('call guardian')
    expect(r.text).toContain('not saved a guardian phone number')
    expect(none.ex.hasPending()).toBe(false)

    const sim = setup({ simulation: true })
    expect((await sim.ex.execute('call guardian')).text).toContain('Simulation mode')
    expect(sim.deps.dial).not.toHaveBeenCalled()
  })
})

describe('Emergency SOS never auto-sends', () => {
  it('opens the confirmation dialog and does not confirm by itself', async () => {
    const { deps, ex } = setup()
    const r = await ex.execute('emergency SOS')
    expect(deps.sos.requestSend).toHaveBeenCalledOnce()
    expect(deps.sos.confirm).not.toHaveBeenCalled()
    expect(r.text).toBe('Opening emergency alert confirmation. Say confirm or tap Send now.')
  })

  it('"yes" only confirms while the dialog is open', async () => {
    const closed = setup()
    expect((await closed.ex.execute('yes')).text).toBe('There is nothing to confirm.')
    expect(closed.deps.sos.confirm).not.toHaveBeenCalled()

    const open = setup({ sos: { live: true, ready: true, requestSend: vi.fn(), confirmOpen: vi.fn(() => true), confirm: vi.fn(), cancel: vi.fn() } })
    await open.ex.execute('confirm')
    expect(open.deps.sos.confirm).toHaveBeenCalledOnce()
  })

  it('"cancel" closes the open dialog without sending', async () => {
    const open = setup({ sos: { live: true, ready: true, requestSend: vi.fn(), confirmOpen: vi.fn(() => true), confirm: vi.fn(), cancel: vi.fn() } })
    const r = await open.ex.execute('cancel')
    expect(open.deps.sos.cancel).toHaveBeenCalled()
    expect(open.deps.sos.confirm).not.toHaveBeenCalled()
    expect(r.text).toContain('Nothing was sent')
  })

  it('routes to the dry run in Simulation and says so; says when setup is missing', async () => {
    const sim = setup({ sos: { live: false, ready: false, requestSend: vi.fn(), confirmOpen: vi.fn(() => false), confirm: vi.fn(), cancel: vi.fn() } })
    const r = await sim.ex.execute('I need help')
    expect(r.text).toContain('Simulation mode')
    expect(r.text).toContain('No real alert will be sent')

    const noGuardian = setup({ sos: { live: true, ready: false, requestSend: vi.fn(), confirmOpen: vi.fn(() => false), confirm: vi.fn(), cancel: vi.fn() } })
    const n = await noGuardian.ex.execute('emergency')
    expect(n.text).toContain('not set up')
    expect(n.ok).toBe(false)
  })
})

describe('control commands and unknown input', () => {
  it('stop listening asks the provider to stop', async () => {
    const { ex } = setup()
    expect((await setup().ex.execute('stop listening')).stopListening).toBe(true)
    expect(ex.hasPending()).toBe(false)
  })

  it('unknown commands say what was heard and show help', async () => {
    const { ex } = setup()
    const r = await ex.execute('make me a sandwich')
    expect(r.text).toBe('Sorry, I didn\'t understand "make me a sandwich". Try saying: open dashboard.')
    expect(r.showHelp).toBe(true)
    expect(r.ok).toBe(false)
  })

  it('help shows the command list', async () => {
    expect((await setup().ex.execute('what can I say')).showHelp).toBe(true)
  })

  it('a stray "no" or number with nothing pending does nothing harmful', async () => {
    const { deps, ex } = setup()
    await ex.execute('no')
    expect((await ex.execute('two')).ok).toBe(false)
    expect(deps.nav.start).not.toHaveBeenCalled()
  })
})

describe('read screen', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reads the heading, sections and status regions of main', () => {
    document.body.innerHTML = `<header><h1>Third Eye</h1></header>
      <main><h1>Dashboard</h1><h2>Devices</h2><h2>Recent activity</h2><h2>Devices</h2>
      <p role="status">Camera is off</p><div aria-live="polite">3 alerts</div><div aria-live="off">hidden</div></main>
      <div role="alert">Server unreachable</div>`
    const text = readScreen(document)
    expect(text).toContain('This is the Dashboard page.')
    expect(text).toContain('Sections: Devices, Recent activity.')
    expect(text).toContain('Camera is off')
    expect(text).toContain('3 alerts')
    expect(text).toContain('Server unreachable')
    expect(text).not.toContain('hidden')
  })

  it('truncates to about 600 characters', () => {
    document.body.innerHTML = `<main><h1>Big</h1><p role="status">${'word '.repeat(400)}</p></main>`
    const text = readScreen(document)
    expect(text.length).toBeLessThanOrEqual(600)
    expect(text.endsWith('…')).toBe(true)
  })

  it('is honest when there is no main region', () => {
    expect(readScreen(document)).toBe('I cannot find the page content to read.')
  })
})

describe('shortLabel', () => {
  it('keeps the first two parts of an address', () => {
    expect(shortLabel('Gandhipuram, Coimbatore, Tamil Nadu, India')).toBe('Gandhipuram, Coimbatore')
    expect(shortLabel('Gandhipuram')).toBe('Gandhipuram')
  })
})
