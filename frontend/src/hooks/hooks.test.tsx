import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mockApi } from '../test-api'
import { renderApp } from '../test-utils'
import { fitFrame, useCamera } from './useCamera'
import { useMode } from '../lib/mode'
import { useSpeech } from './useSpeech'

const DEVICE = { key: 'laptop_camera', name: 'Laptop/USB Camera', status: 'connected', last_seen: null, config: {}, error: null }

function fakeStream() {
  const track = { stop: vi.fn(), readyState: 'live', addEventListener: vi.fn() }
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream }
}

function Harness() {
  const cam = useCamera()
  return (
    <div>
      <p data-testid="status">{cam.status}</p>
      <p data-testid="msg">{cam.message ?? ''}</p>
      <p data-testid="devices">{cam.devices.map((d) => d.label).join(',')}</p>
      <video ref={cam.videoRef} />
      <button onClick={() => void cam.start()}>start</button>
      <button onClick={() => cam.stop()}>stop</button>
    </div>
  )
}

function routes(extra: Record<string, unknown> = {}) {
  return mockApi({
    'GET /settings': DEFAULT_SETTINGS,
    'POST /devices/laptop_camera/report': DEVICE,
    'POST /events': { id: 1 },
    ...extra,
  })
}

function stubMedia(getUserMedia: () => Promise<MediaStream>) {
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn(getUserMedia),
      enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'cam1', label: 'HD Webcam' }]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

describe('fitFrame', () => {
  it('caps the longest side at 1280 and never upscales', () => {
    expect(fitFrame(1920, 1080)).toEqual({ width: 1280, height: 720 })
    expect(fitFrame(640, 480)).toEqual({ width: 640, height: 480 })
    expect(fitFrame(1000, 2560)).toEqual({ width: 500, height: 1280 })
  })
})

describe('useCamera', () => {
  it('starts, reports connected, logs a live session, lists devices and stops tracks on stop', async () => {
    const { stream, track } = fakeStream()
    stubMedia(async () => stream)
    const api = routes()
    renderApp(<Harness />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('active'))
    await waitFor(() => expect(api.callsTo('POST', '/devices/laptop_camera/report')[0]?.body).toEqual({ status: 'connected' }))
    expect(api.callsTo('POST', '/events')[0].body).toMatchObject({ type: 'camera_session', source: 'live' })
    await waitFor(() => expect(screen.getByTestId('devices')).toHaveTextContent('HD Webcam'))
    await userEvent.click(screen.getByText('stop'))
    expect(track.stop).toHaveBeenCalled()
    expect(screen.getByTestId('status')).toHaveTextContent('idle')
    await waitFor(() => expect(api.callsTo('POST', '/devices/laptop_camera/report').at(-1)?.body).toEqual({ status: 'disconnected' }))
    const ended = api.callsTo('POST', '/events').at(-1)!.body as { details: { durationSeconds: number } }
    expect(ended.details.durationSeconds).toBeGreaterThanOrEqual(0)
  })

  it.each([
    ['NotAllowedError', 'denied', /permission was denied/i, 'error'],
    ['NotFoundError', 'no-device', /No camera was found/i, 'disconnected'],
    ['NotReadableError', 'error', /in use by another application/i, 'error'],
    ['OverconstrainedError', 'error', /selected camera is not available/i, 'error'],
  ])('%s gives status %s with a human message and reports it', async (name, status, text, reported) => {
    stubMedia(async () => Promise.reject(Object.assign(new Error('x'), { name })))
    const api = routes()
    renderApp(<Harness />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(new RegExp(`^${status}$`)))
    expect(screen.getByTestId('msg')).toHaveTextContent(text)
    await waitFor(() => expect(api.callsTo('POST', '/devices/laptop_camera/report')[0].body).toMatchObject({ status: reported }))
  })

  it('stops the camera tracks when unmounted', async () => {
    const { stream, track } = fakeStream()
    stubMedia(async () => stream)
    routes()
    const view = renderApp(<Harness />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('active'))
    view.unmount()
    expect(track.stop).toHaveBeenCalled()
  })

  it('re-reports connected every 30 s while active', async () => {
    const { stream } = fakeStream()
    stubMedia(async () => stream)
    const api = routes()
    renderApp(<Harness />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('active'))
    const before = api.callsTo('POST', '/devices/laptop_camera/report').length
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      // The interval was created with real timers, so drive a fresh one by restarting.
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByText('stop'))
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByText('start'))
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('active'))
      const mid = api.callsTo('POST', '/devices/laptop_camera/report').length
      await act(async () => {
        vi.advanceTimersByTime(30_000)
      })
      await waitFor(() => expect(api.callsTo('POST', '/devices/laptop_camera/report').length).toBeGreaterThan(mid))
      expect(mid).toBeGreaterThan(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('simulation mode never reports device status and tags events simulation', async () => {
    const { stream } = fakeStream()
    stubMedia(async () => stream)
    const api = routes()
    renderApp(<Harness />, { mode: 'simulation' })
    await userEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('active'))
    await userEvent.click(screen.getByText('stop'))
    await waitFor(() => expect(api.callsTo('POST', '/events').length).toBe(2))
    expect(api.callsTo('POST', '/devices/laptop_camera/report')).toHaveLength(0)
    expect(api.callsTo('POST', '/events').every((c) => (c.body as { source: string }).source === 'simulation')).toBe(true)
  })
})

function SpeechHarness({ now }: { now: { t: number } }) {
  const s = useSpeech()
  return (
    <div>
      <button onClick={() => (document.title = String(s.announce('Person detected ahead.', 'medium', now.t)))}>a-medium</button>
      <button onClick={() => (document.title = String(s.announce('Person detected ahead.', 'critical', now.t)))}>a-critical</button>
      <button onClick={() => (document.title = String(s.announce('Vehicle ahead.', 'medium', now.t)))}>a-other</button>
      <button onClick={() => (document.title = String(s.announce('Person detected ahead.', 'high', now.t)))}>a-high</button>
      <button onClick={() => (document.title = String(s.announce('Person detected ahead.', 'low', now.t)))}>a-low</button>
    </div>
  )
}

describe('useSpeech', () => {
  function stubSpeech(speaking = false) {
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [], speaking }
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, t: string) { this.text = t })
    return synth
  }

  it('dedupes within 6 s unless the risk escalates, then allows again after 6 s', async () => {
    const synth = stubSpeech()
    routes()
    const now = { t: 1_000_000 }
    renderApp(<SpeechHarness now={now} />)
    await waitFor(() => expect(screen.getByText('a-medium')).toBeEnabled())
    await new Promise((r) => setTimeout(r, 30)) // let settings load
    await userEvent.click(screen.getByText('a-medium'))
    expect(document.title).toBe('new')
    now.t += 2000
    await userEvent.click(screen.getByText('a-medium'))
    expect(document.title).toBe('false')
    await userEvent.click(screen.getByText('a-critical'))
    expect(document.title).toBe('new')
    expect(synth.cancel).toHaveBeenCalled() // critical interrupts
    // a text change is announced as new
    await userEvent.click(screen.getByText('a-other'))
    expect(document.title).toBe('new')
  })

  async function setupRepeat(speaking = false) {
    const synth = stubSpeech(speaking)
    routes()
    const now = { t: 1_000_000 }
    renderApp(<SpeechHarness now={now} />)
    await new Promise((r) => setTimeout(r, 30))
    return { synth, now }
  }
  const press = async (name: string) => {
    await userEvent.click(screen.getByText(name))
    return document.title
  }

  it('a critical hazard that stays in view is suppressed at 7 s and announced again after 10 s', async () => {
    const { synth, now } = await setupRepeat()
    expect(await press('a-critical')).toBe('new')
    now.t += 7000
    expect(await press('a-critical')).toBe('false')
    now.t += 3000
    expect(await press('a-critical')).toBe('repeat')
    expect(synth.speak).toHaveBeenCalledTimes(2)
    // the timer restarts from the repeat
    now.t += 9000
    expect(await press('a-critical')).toBe('false')
    now.t += 1000
    expect(await press('a-critical')).toBe('repeat')
  })

  it('a high hazard repeats after 15 s, not before', async () => {
    const { now } = await setupRepeat()
    expect(await press('a-high')).toBe('new')
    now.t += 14_000
    expect(await press('a-high')).toBe('false')
    now.t += 1000
    expect(await press('a-high')).toBe('repeat')
  })

  it('low and medium risk are never repeated within 60 s, then refreshed', async () => {
    const { now } = await setupRepeat()
    expect(await press('a-medium')).toBe('new')
    now.t += 59_000
    expect(await press('a-medium')).toBe('false')
    now.t += 1000
    expect(await press('a-medium')).toBe('repeat')
    expect(await press('a-low')).toBe('false') // lower risk of the same text is still unchanged
    now.t += 30_000
    expect(await press('a-low')).toBe('false')
  })

  it('a repeat never interrupts or queues behind other speech, and is retried once the speaker is free', async () => {
    const { synth, now } = await setupRepeat()
    expect(await press('a-critical')).toBe('new')
    synth.cancel.mockClear()
    synth.speak.mockClear()
    synth.speaking = true
    now.t += 11_000
    expect(await press('a-critical')).toBe('false') // busy: nothing cancelled, nothing queued
    expect(synth.cancel).not.toHaveBeenCalled()
    expect(synth.speak).not.toHaveBeenCalled()
    synth.speaking = false
    now.t += 500
    expect(await press('a-critical')).toBe('repeat') // not starved: tries again right away
    expect(synth.speak).toHaveBeenCalledTimes(1)
  })

  it('does not queue lower-risk speech behind speech already playing, and respects the feedback setting', async () => {
    const synth = stubSpeech(true)
    routes()
    const now = { t: 5_000_000 }
    renderApp(<SpeechHarness now={now} />)
    await new Promise((r) => setTimeout(r, 30))
    await userEvent.click(screen.getByText('a-medium'))
    expect(synth.speak).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    const off = stubSpeech()
    mockApi({ 'GET /settings': { ...DEFAULT_SETTINGS, voice: { ...DEFAULT_SETTINGS.voice, feedback: false } } })
    renderApp(<SpeechHarness now={{ t: 9_000_000 }} />)
    await new Promise((r) => setTimeout(r, 30))
    await userEvent.click(screen.getAllByText('a-critical')[1])
    expect(document.title).toBe('new') // announced for the live region ...
    expect(off.speak).not.toHaveBeenCalled() // ... but not spoken
  })
})

describe('useCamera stale requests and sessions', () => {
  function deferred() {
    let resolve!: (s: MediaStream) => void
    const promise = new Promise<MediaStream>((r) => (resolve = r))
    return { promise, resolve }
  }

  it('stop while the permission prompt is open: late stream is released and nothing is reported', async () => {
    const d = deferred()
    const { stream, track } = fakeStream()
    stubMedia(() => d.promise)
    const api = routes()
    renderApp(<Harness />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    expect(screen.getByTestId('status')).toHaveTextContent('requesting')
    await userEvent.click(screen.getByText('stop'))
    await act(async () => d.resolve(stream))
    expect(track.stop).toHaveBeenCalled()
    expect(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(api.callsTo('POST', '/devices/laptop_camera/report')).toHaveLength(0)
    expect(api.callsTo('POST', '/events')).toHaveLength(0)
  })

  it('unmount while pending: late stream is released and nothing is reported', async () => {
    const d = deferred()
    const { stream, track } = fakeStream()
    stubMedia(() => d.promise)
    const api = routes()
    const view = renderApp(<Harness />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    view.unmount()
    await act(async () => d.resolve(stream))
    expect(track.stop).toHaveBeenCalled()
    expect(api.callsTo('POST', '/devices/laptop_camera/report')).toHaveLength(0)
    expect(api.callsTo('POST', '/events')).toHaveLength(0)
  })

  it('a late rejection after stop does not flip the status to an error', async () => {
    let reject!: (e: unknown) => void
    stubMedia(() => new Promise<MediaStream>((_, r) => (reject = r)))
    const api = routes()
    renderApp(<Harness />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    await userEvent.click(screen.getByText('stop'))
    await act(async () => reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })))
    expect(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(api.callsTo('POST', '/devices/laptop_camera/report')).toHaveLength(0)
  })

  it('a failed start leaves no open session: a later stop logs no phantom session', async () => {
    stubMedia(async () => Promise.reject(Object.assign(new Error('x'), { name: 'NotReadableError' })))
    const api = routes()
    renderApp(<Harness />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
    await userEvent.click(screen.getByText('stop'))
    expect(api.callsTo('POST', '/events')).toHaveLength(0)
  })
})

function SwitchHarness() {
  const cam = useCamera()
  return (
    <div>
      <p data-testid="status">{cam.status}</p>
      <video ref={cam.videoRef} />
      <button onClick={() => void cam.start()}>start</button>
      <button onClick={() => void cam.selectDevice('cam2')}>switch</button>
      <button
        onClick={async () => {
          const b = await cam.captureFrame()
          document.title = b.type
        }}
      >
        capture
      </button>
    </div>
  )
}

describe('useCamera sessions and capture', () => {
  it('switching cameras logs the old session end and a new start, with no disconnect report', async () => {
    const { stream } = fakeStream()
    stubMedia(async () => stream)
    const api = routes()
    renderApp(<SwitchHarness />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('active'))
    await userEvent.click(screen.getByText('switch'))
    await waitFor(() => expect(api.callsTo('POST', '/events').length).toBe(3))
    const titles = api.callsTo('POST', '/events').map((c) => (c.body as { title: string }).title)
    expect(titles).toEqual(['Camera session started', 'Camera session ended', 'Camera session started'])
    expect(api.callsTo('POST', '/events')[1].body).toMatchObject({ details: { reason: 'switched camera' } })
    expect(api.callsTo('POST', '/devices/laptop_camera/report').every((c) => (c.body as { status: string }).status === 'connected')).toBe(true)
  })

  it('captureFrame never flips the image even with mirror on, and outputs JPEG at quality 0.8', async () => {
    const { stream } = fakeStream()
    stubMedia(async () => stream)
    const scale = vi.fn()
    const toBlob = vi.fn((cb: BlobCallback, _type?: string, _q?: number) => cb(new Blob(['x'], { type: 'image/jpeg' })))
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ scale, translate: vi.fn(), drawImage: vi.fn() })) as never
    HTMLCanvasElement.prototype.toBlob = toBlob as never
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 })
    routes({ 'GET /settings': { ...DEFAULT_SETTINGS, camera: { deviceId: null, preferences: { mirror: true } } } })
    renderApp(<SwitchHarness />, { mode: 'live' })
    await new Promise((r) => setTimeout(r, 50))
    await userEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('active'))
    await userEvent.click(screen.getByText('capture'))
    await waitFor(() => expect(document.title).toBe('image/jpeg'))
    expect(scale).not.toHaveBeenCalled()
    expect(toBlob.mock.calls[0][1]).toBe('image/jpeg')
    expect(toBlob.mock.calls[0][2]).toBe(0.8)
  })

  it('switching Live to Simulation while the camera runs reports the real camera as disconnected', async () => {
    const { stream } = fakeStream()
    stubMedia(async () => stream)
    const api = routes()
    function Switcher() {
      const { setMode } = useMode()
      return (
        <>
          <SwitchHarness />
          <button onClick={() => setMode('simulation')}>to-sim</button>
        </>
      )
    }
    renderApp(<Switcher />, { mode: 'live' })
    await userEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('active'))
    await userEvent.click(screen.getByText('to-sim'))
    await waitFor(() => expect(api.callsTo('POST', '/devices/laptop_camera/report').at(-1)?.body).toEqual({ status: 'disconnected' }))
    const ev = api.callsTo('POST', '/events')
    expect(ev.at(-2)?.body).toMatchObject({ title: 'Camera session ended', source: 'live' })
    expect(ev.at(-1)?.body).toMatchObject({ title: 'Camera session started', source: 'simulation' })
  })
})

describe('shared speech controller', () => {
  function Two() {
    const page = useSpeech()
    const dist = useSpeech()
    return (
      <div>
        <button onClick={() => page.announce('Person detected ahead.', 'critical', 1)}>page-critical</button>
        <button onClick={() => dist.announce('Simulated: obstacle close ahead.', 'high', 1)}>dist-high</button>
      </div>
    )
  }
  it('a lower-risk speaker from another instance cannot cut off an active critical announcement', async () => {
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [], speaking: false }
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, t: string) { this.text = t })
    routes()
    renderApp(<Two />)
    await new Promise((r) => setTimeout(r, 40))
    await userEvent.click(screen.getByText('page-critical'))
    expect(synth.speak).toHaveBeenCalledTimes(1)
    synth.speaking = true
    synth.cancel.mockClear()
    await userEvent.click(screen.getByText('dist-high'))
    expect(synth.cancel).not.toHaveBeenCalled()
    expect(synth.speak).toHaveBeenCalledTimes(1)
  })
})
