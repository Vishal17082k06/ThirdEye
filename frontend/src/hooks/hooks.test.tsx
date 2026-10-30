import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mockApi } from '../test-api'
import { renderApp } from '../test-utils'
import { fitFrame, useCamera } from './useCamera'
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
    expect(document.title).toBe('true')
    now.t += 2000
    await userEvent.click(screen.getByText('a-medium'))
    expect(document.title).toBe('false')
    await userEvent.click(screen.getByText('a-critical'))
    expect(document.title).toBe('true')
    expect(synth.cancel).toHaveBeenCalled() // critical interrupts
    now.t += 7000
    await userEvent.click(screen.getByText('a-critical'))
    expect(document.title).toBe('true')
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
    expect(document.title).toBe('true') // announced for the live region ...
    expect(off.speak).not.toHaveBeenCalled() // ... but not spoken
  })
})
