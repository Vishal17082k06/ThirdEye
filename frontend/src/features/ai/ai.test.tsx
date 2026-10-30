import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { AiAssistance } from './AiAssistance'
import { validateImageFile, type DetectResult } from './detect'

const DEVICE = { key: 'laptop_camera', name: 'Laptop/USB Camera', status: 'connected', last_seen: null, config: {}, error: null }

const det = (label: string, risk: string, box = { x: 0.3, y: 0.2, w: 0.3, h: 0.5 }, position = 'ahead', confidence = 0.87) => ({
  label,
  confidence,
  box,
  position,
  risk,
  announcement: `${label} ${position}.`,
})

const result = (detections: ReturnType<typeof det>[], text: string, highest: string | null): DetectResult =>
  ({
    detections,
    summary: { text, highest_risk: highest },
    image: { width: 640, height: 480 },
    inference_ms: 42,
    source: 'live',
    model: 'yolov8n-onnx',
  }) as DetectResult

const PERSON = result([det('person', 'high')], 'Person detected ahead.', 'high')

interface DetectCall {
  source: string | null
  record: string | null
  conf: string | null
  type: string | undefined
}

/** fetch stub: /api/detect gets multipart handling, everything else goes through mockApi. */
function setup(respond: (n: number) => unknown, extra: Record<string, unknown> = {}) {
  const api = mockApi({
    'GET /settings': DEFAULT_SETTINGS,
    'POST /devices/laptop_camera/report': DEVICE,
    'POST /events': { id: 1 },
    ...extra,
  })
  const detect: DetectCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/detect') {
        const form = init?.body as FormData
        detect.push({
          source: form.get('source') as string | null,
          record: form.get('record') as string | null,
          conf: form.get('conf') as string | null,
          type: (form.get('file') as File | null)?.type,
        })
        const out = respond(detect.length) as { __status?: number; body?: unknown }
        if (out && typeof out === 'object' && '__status' in out) return new Response(JSON.stringify(out.body), { status: out.__status })
        return new Response(JSON.stringify(out), { status: 200 })
      }
      return api.fn(input, init)
    }),
  )
  return { api, detect }
}

let fillText: ReturnType<typeof vi.fn>
let strokeRect: ReturnType<typeof vi.fn>
let stopTrack: ReturnType<typeof vi.fn>
let speak: ReturnType<typeof vi.fn>
let scale: ReturnType<typeof vi.fn>
let scaleAtFirstDraw: number[] = []

beforeEach(() => {
  fillText = vi.fn()
  strokeRect = vi.fn()
  stopTrack = vi.fn()
  speak = vi.fn()
  scale = vi.fn()
  scaleAtFirstDraw = []
  const ctx = {
    clearRect: vi.fn(),
    strokeRect,
    fillRect: vi.fn(),
    fillText,
    setLineDash: vi.fn(),
    measureText: () => ({ width: 50 }),
    translate: vi.fn(),
    scale,
    drawImage: vi.fn(() => scaleAtFirstDraw.push(scale.mock.calls.length)),
    save: vi.fn(),
    restore: vi.fn(),
  }
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['x'], { type: 'image/jpeg' }))
  }
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  const track = { stop: stopTrack, readyState: 'live', addEventListener: vi.fn() }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'cam1', label: 'HD Webcam' }]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => [], speaking: false })
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, t: string) { this.text = t })
})
afterEach(() => vi.unstubAllGlobals())

async function startDetection() {
  await userEvent.click(await screen.findByRole('button', { name: 'Start camera' }))
  const go = screen.getByRole('button', { name: 'Start obstacle detection' })
  await waitFor(() => expect(go).toBeEnabled())
  await userEvent.click(go)
}

describe('validateImageFile', () => {
  it('accepts jpeg/png under 10 MB and rejects the rest', () => {
    expect(validateImageFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBeUndefined()
    expect(validateImageFile(new File(['x'], 'a.gif', { type: 'image/gif' }))).toMatch(/JPEG or PNG/)
    const big = new File(['x'], 'b.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 })
    expect(validateImageFile(big)).toMatch(/10 MB/)
  })
})

describe('AI Assistance page', () => {
  it('always shows the honesty note, the risk legend and the controls', async () => {
    setup(() => PERSON)
    renderApp(<AiAssistance />, { mode: 'live' })
    expect(screen.getByText('Camera detection cannot confirm that a path is safe. Stay alert and use your cane or guide.')).toBeInTheDocument()
    const legend = screen.getByRole('list', { name: 'Risk levels' })
    for (const r of ['Low', 'Medium', 'High', 'Critical']) expect(within(legend).getByText(r)).toBeInTheDocument()
    for (const n of ['Start camera', 'Stop camera', 'Capture image', 'Start obstacle detection']) {
      expect(screen.getByRole('button', { name: n })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'View in Activity History' })).toHaveAttribute('href', '/history')
    expect(screen.queryByText(/SIMULATION MODE/)).not.toBeInTheDocument()
  })

  it('posts frames to /api/detect and shows boxes, list, summary, announcement and history', async () => {
    const { detect, api } = setup(() => PERSON)
    renderApp(<AiAssistance />, { mode: 'live' })
    await startDetection()
    await waitFor(() => expect(detect.length).toBe(1))
    expect(detect[0]).toMatchObject({ source: 'live', record: 'true', conf: null, type: 'image/jpeg' })
    const list = await screen.findByRole('list', { name: 'Detections' })
    expect(within(list).getByText('person')).toBeInTheDocument()
    expect(within(list).getByText(/87% confidence, ahead/)).toBeInTheDocument()
    expect(screen.getByTestId('summary-text')).toHaveTextContent('Person detected ahead.')
    expect(screen.getByTestId('live-assertive')).toHaveTextContent('Person detected ahead.')
    expect(screen.getByTestId('live-polite')).toBeEmptyDOMElement()
    await waitFor(() => expect(fillText).toHaveBeenCalledWith('HIGH person 87% ahead', expect.any(Number), expect.any(Number)))
    expect(strokeRect).toHaveBeenCalled()
    expect(speak).toHaveBeenCalled()
    expect(within(screen.getByRole('list', { name: 'Detection history' })).getByText('Person detected ahead.')).toBeInTheDocument()
    // live mode reports the laptop camera as connected
    expect(api.callsTo('POST', '/devices/laptop_camera/report')[0].body).toEqual({ status: 'connected' })
    // stopping really stops the tracks and the stale result goes away
    await userEvent.click(screen.getByRole('button', { name: 'Stop camera' }))
    expect(stopTrack).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Detections' })).not.toBeInTheDocument())
  })

  it('does not repeat an identical announcement and sends record=true only every 5 s', async () => {
    const { detect } = setup(() => PERSON)
    renderApp(<AiAssistance />, { mode: 'live' })
    await startDetection()
    await waitFor(() => expect(detect.length).toBeGreaterThanOrEqual(2), { timeout: 4000 })
    expect(detect[1].record).toBe('false')
    expect(within(screen.getByRole('list', { name: 'Detection history' })).getAllByRole('listitem')).toHaveLength(1)
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('says Vehicle approaching only after the box grows across frames', async () => {
    const car = (s: number) => result([det('car', 'medium', { x: 0.4 - s / 2, y: 0.4 - s / 2, w: s, h: s })], 'Vehicle ahead.', 'medium')
    const sizes = [0.2, 0.2, 0.3, 0.4]
    const { detect } = setup((n) => car(sizes[Math.min(n - 1, sizes.length - 1)]))
    renderApp(<AiAssistance />, { mode: 'live' })
    await startDetection()
    await waitFor(() => expect(screen.getByTestId('summary-text')).toHaveTextContent('Vehicle ahead.'))
    await waitFor(() => expect(screen.getByTestId('summary-text')).toHaveTextContent('Vehicle approaching.'), { timeout: 6000 })
    expect(detect.length).toBeGreaterThanOrEqual(3)
  })

  it('shows the exact clear-path text only when the server says it', async () => {
    setup(() => result([], 'Path appears clear in the current camera view.', null))
    renderApp(<AiAssistance />, { mode: 'live' })
    await startDetection()
    await waitFor(() => expect(screen.getByTestId('summary-text')).toHaveTextContent(/^Path appears clear in the current camera view\.$/))
    expect(screen.getByText('No objects detected in this frame.')).toBeInTheDocument()
  })

  it('renders the server summary as given when only low-risk objects are seen', async () => {
    setup(() => result([det('chair', 'low')], 'Objects detected in view, none close.', 'low'))
    renderApp(<AiAssistance />, { mode: 'live' })
    await startDetection()
    await waitFor(() => expect(screen.getByTestId('summary-text')).toHaveTextContent('Objects detected in view, none close.'))
    expect(screen.queryByText(/Path appears clear/)).not.toBeInTheDocument()
  })

  it('503 shows Detection engine unavailable, no detections, and stops detecting', async () => {
    setup(() => ({ __status: 503, body: { detail: 'Detection model not found. Run backend/scripts/export_model.py' } }))
    renderApp(<AiAssistance />, { mode: 'live' })
    await startDetection()
    expect(await screen.findByText('Detection engine unavailable')).toBeInTheDocument()
    expect(screen.getByText(/Detection model not found/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Detections' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start obstacle detection' })).toBeEnabled()
    expect(fillText).not.toHaveBeenCalled()
  })

  it('simulation mode: banner, source=simulation, events tagged simulation, device status never reported', async () => {
    const { api, detect } = setup(() => PERSON)
    renderApp(<AiAssistance />, { mode: 'simulation' })
    expect(screen.getByText(/SIMULATION MODE/)).toBeInTheDocument()
    await startDetection()
    await waitFor(() => expect(detect.length).toBe(1))
    expect(detect[0].source).toBe('simulation')
    await userEvent.click(screen.getByRole('button', { name: 'Stop camera' }))
    await waitFor(() => expect(api.callsTo('POST', '/events').length).toBe(2))
    expect(api.callsTo('POST', '/devices/laptop_camera/report')).toHaveLength(0)
    expect(api.callsTo('POST', '/events').every((c) => (c.body as { source: string }).source === 'simulation')).toBe(true)
  })

  it('upload: previews, analyses with record=true and the mode source, and draws boxes', async () => {
    const { detect } = setup(() => PERSON)
    renderApp(<AiAssistance />, { mode: 'live' })
    const input = screen.getByLabelText('Choose an image to analyse')
    await userEvent.upload(input, new File(['img'], 'street.png', { type: 'image/png' }))
    expect(screen.getByAltText('Preview of street.png')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    await waitFor(() => expect(detect.length).toBe(1))
    expect(detect[0]).toMatchObject({ source: 'live', record: 'true', type: 'image/png' })
    expect(await screen.findByText('Image summary')).toBeInTheDocument()
    expect(fillText).toHaveBeenCalled()
  })

  it('upload: rejects wrong types before sending and shows server errors', async () => {
    const { detect } = setup(() => ({ __status: 422, body: { detail: 'The image could not be read.' } }))
    renderApp(<AiAssistance />, { mode: 'simulation' })
    const input = screen.getByLabelText('Choose an image to analyse')
    // userEvent.upload honours accept, so fire the change directly for a disallowed type
    const bad = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
    await userEvent.setup({ applyAccept: false }).upload(input, bad)
    expect(await screen.findByText('Choose a JPEG or PNG image.')).toBeInTheDocument()
    expect(detect).toHaveLength(0)
    await userEvent.upload(input, new File(['x'], 'ok.jpg', { type: 'image/jpeg' }))
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    expect(await screen.findByText('The image could not be read.')).toBeInTheDocument()
    expect(detect[0].source).toBe('simulation')
  })

  it('capture image sends a frame as a manual analysis', async () => {
    const { detect } = setup(() => PERSON)
    renderApp(<AiAssistance />, { mode: 'live' })
    await userEvent.click(await screen.findByRole('button', { name: 'Start camera' }))
    const cap = screen.getByRole('button', { name: 'Capture image' })
    await waitFor(() => expect(cap).toBeEnabled())
    await userEvent.click(cap)
    await waitFor(() => expect(detect.length).toBe(1))
    expect(detect[0]).toMatchObject({ record: 'true', type: 'image/jpeg' })
    expect(await screen.findByAltText('Preview of Captured from camera')).toBeInTheDocument()
  })

  it('never mirrors the uploaded frame; only the preview and the overlay are flipped together', async () => {
    const { detect } = setup(() => PERSON, {
      'GET /settings': { ...DEFAULT_SETTINGS, camera: { deviceId: null, preferences: { mirror: true } } },
    })
    renderApp(<AiAssistance />, { mode: 'live' })
    await waitFor(() => expect(screen.getByLabelText('Live camera preview')).toHaveStyle({ transform: 'scaleX(-1)' }))
    await startDetection()
    await waitFor(() => expect(detect.length).toBe(1))
    // the captured frame went through drawImage with no flip applied to it
    expect(scaleAtFirstDraw[0]).toBe(0)
    await waitFor(() => expect(document.querySelector('canvas[aria-hidden]')).toHaveStyle({ transform: 'scaleX(-1)' }))
    expect(screen.getByLabelText('Live camera preview')).toHaveClass('object-fill')
  })

  it('leaves the overlay unflipped when mirror is off', async () => {
    const { detect } = setup(() => PERSON)
    renderApp(<AiAssistance />, { mode: 'live' })
    await startDetection()
    await waitFor(() => expect(detect.length).toBe(1))
    await waitFor(() => expect(document.querySelector('canvas[aria-hidden]')).toBeInTheDocument())
    expect(document.querySelector('canvas[aria-hidden]')).not.toHaveStyle({ transform: 'scaleX(-1)' })
  })

  it('a manual Analyse of an unchanged result still updates the live region', async () => {
    setup(() => PERSON)
    renderApp(<AiAssistance />, { mode: 'live' })
    await userEvent.upload(screen.getByLabelText('Choose an image to analyse'), new File(['i'], 'a.jpg', { type: 'image/jpeg' }))
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    await waitFor(() => expect(screen.getByTestId('live-assertive').textContent).toContain('Person detected ahead.'))
    const first = screen.getByTestId('live-assertive').textContent
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    await waitFor(() => expect(screen.getByTestId('live-assertive').textContent).not.toBe(first))
    expect(within(screen.getByRole('list', { name: 'Detection history' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('repeats a critical hazard that stays in view by voice but does not append duplicate history', async () => {
    const critical = result([det('person', 'critical')], 'Person detected ahead.', 'critical')
    const { detect } = setup(() => critical)
    const real = Date.now
    let offset = 0
    vi.spyOn(Date, 'now').mockImplementation(() => real() + offset)
    try {
      renderApp(<AiAssistance />, { mode: 'live' })
      await startDetection()
      await waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
      offset = 11_000
      await waitFor(() => expect(detect.length).toBeGreaterThanOrEqual(2), { timeout: 4000 })
      await waitFor(() => expect(speak).toHaveBeenCalledTimes(2))
      expect(within(screen.getByRole('list', { name: 'Detection history' })).getAllByRole('listitem')).toHaveLength(1)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
