import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { AiAssistance } from '../ai/AiAssistance'
import { proximityBand } from './proximity'
import { SCENARIOS, scenarioResult } from './scenarios'
import { TEST_VOICE_TEXT } from './SimulationSection'
import { SosDryRun } from './SosDryRun'

const GUARDIAN = { name: 'Meera Raman', email: 'meera@example.com', phone: '+919800000000', relationship: 'Sister' }

let speak: ReturnType<typeof vi.fn>

function setup(extra: Record<string, unknown> = {}) {
  const api = mockApi({
    'GET /settings': DEFAULT_SETTINGS,
    'GET /guardian': GUARDIAN,
    'POST /events': { id: 1 },
    ...extra,
  })
  const base = globalThis.fetch
  const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => base(input, init))
  vi.stubGlobal('fetch', fetchSpy)
  return { api, fetchSpy }
}

beforeEach(() => {
  speak = vi.fn()
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => [], speaking: false })
  vi.stubGlobal('SpeechSynthesisUtterance', function (this: { text: string }, t: string) { this.text = t })
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
})
afterEach(() => vi.unstubAllGlobals())

describe('scenario wording', () => {
  it('never reuses the phrases only the real detector may produce', () => {
    for (const sc of SCENARIOS) {
      for (const text of [sc.text, ...sc.detections.map((d) => d.announcement), scenarioResult(sc).summary.text]) {
        expect(text).not.toBe('Path appears clear in the current camera view.')
        expect(text).not.toBe('Vehicle approaching.')
        expect(text.startsWith('Simulated:')).toBe(true)
      }
    }
    expect(SCENARIOS.find((s) => s.id === 'clear')!.text).toBe('Simulated: no objects in this scenario.')
  })
  it('spoken distance warnings start with Simulated and the far band is worded honestly', () => {
    for (const cm of [30, 80, 150]) expect(proximityBand(cm).warning.startsWith('Simulated')).toBe(true)
    expect(proximityBand(300).warning).toBe('No simulated reading closer than 2 metres.')
  })
})

describe('proximityBand', () => {
  it('maps distances to bands', () => {
    expect(proximityBand(30).risk).toBe('critical')
    expect(proximityBand(80).risk).toBe('high')
    expect(proximityBand(150).risk).toBe('medium')
    expect(proximityBand(300)).toMatchObject({ risk: 'low', speak: false })
  })
})

describe('Simulation tools on the AI page', () => {
  it('are hidden in Live mode', () => {
    setup()
    renderApp(<AiAssistance />, { mode: 'live' })
    expect(screen.queryByText('Simulation tools')).not.toBeInTheDocument()
  })

  it('scenarios run through announcements and history without calling the detector, tagged simulation', async () => {
    const { api } = setup()
    renderApp(<AiAssistance />, { mode: 'simulation' })
    await userEvent.selectOptions(screen.getByLabelText('Scenario'), 'Vehicle approaching')
    await userEvent.click(screen.getByRole('button', { name: 'Run scenario' }))
    expect(screen.getByTestId('summary-text')).toHaveTextContent('Simulated: vehicle ahead, getting closer.')
    expect(screen.getByTestId('live-assertive')).toHaveTextContent('Simulated: vehicle ahead, getting closer.')
    expect(speak).toHaveBeenCalled()
    const history = screen.getByRole('list', { name: 'Detection history' })
    expect(within(history).getByText('Simulated')).toBeInTheDocument()
    await waitFor(() => expect(api.callsTo('POST', '/events')).toHaveLength(1))
    expect(api.callsTo('POST', '/events')[0].body).toMatchObject({
      type: 'ai_analysis',
      source: 'simulation',
      notify: true,
      details: { kind: 'scenario' },
    })
    expect(api.calls.some((c) => c.path === '/detect')).toBe(false)
    expect(api.calls.some((c) => c.path.startsWith('/devices'))).toBe(false)
  })

  it('a clear-path scenario is labelled simulated and a low-risk one does not notify', async () => {
    const { api } = setup()
    renderApp(<AiAssistance />, { mode: 'simulation' })
    await userEvent.selectOptions(screen.getByLabelText('Scenario'), 'Obstacle on left')
    await userEvent.click(screen.getByRole('button', { name: 'Run scenario' }))
    await waitFor(() => expect(api.callsTo('POST', '/events')).toHaveLength(1))
    expect((api.callsTo('POST', '/events')[0].body as { notify: boolean }).notify).toBe(false)
  })

  it('the distance sensor is labelled simulated, speaks warnings, logs at most every 5 s and never reports devices', async () => {
    const { api } = setup()
    renderApp(<AiAssistance />, { mode: 'simulation' })
    expect(screen.getByText('Simulated reading')).toBeInTheDocument()
    expect(screen.getByText(/does not change the real sensor status/)).toBeInTheDocument()
    await waitFor(() => expect(api.callsTo('GET', '/settings').length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 50)) // let the voice settings land
    const slider = screen.getByLabelText('Distance')
    fireEvent.change(slider, { target: { value: '40' } })
    expect(screen.getByTestId('distance-value')).toHaveTextContent('40 cm')
    expect(screen.getByText('Simulated: stop. Obstacle very close.')).toBeInTheDocument()
    expect(speak).toHaveBeenCalled()
    fireEvent.change(slider, { target: { value: '60' } })
    fireEvent.change(slider, { target: { value: '90' } })
    await waitFor(() => expect(api.callsTo('POST', '/events')).toHaveLength(1))
    expect(api.callsTo('POST', '/events')[0].body).toMatchObject({ type: 'distance_reading', source: 'simulation' })
    expect(api.calls.some((c) => c.path.startsWith('/devices'))).toBe(false)
  })

  it('the test voice button really speaks even if nothing was detected', async () => {
    setup()
    renderApp(<AiAssistance />, { mode: 'simulation' })
    await userEvent.click(screen.getByRole('button', { name: 'Test voice announcement' }))
    expect(speak).toHaveBeenCalledTimes(1)
    expect((speak.mock.calls[0][0] as { text: string }).text).toBe(TEST_VOICE_TEXT)
  })

  it('device simulation is labelled and sends nothing', async () => {
    const { api } = setup()
    renderApp(<AiAssistance />, { mode: 'simulation' })
    await userEvent.selectOptions(screen.getByLabelText('ESP32-CAM (simulated)'), 'Error')
    expect(screen.getByTestId('sim-esp32_cam')).toHaveTextContent('Simulated Error')
    expect(api.calls.some((c) => c.method !== 'GET')).toBe(false)
  })

  it('links to the navigation page', () => {
    setup()
    renderApp(<AiAssistance />, { mode: 'simulation' })
    expect(screen.getByRole('link', { name: /Test navigation interface/ })).toHaveAttribute('href', '/navigation')
  })

  it('SOS dry run shows the guardian, records a simulation event and says nothing was sent', async () => {
    const { api } = setup()
    renderApp(<AiAssistance />, { mode: 'simulation' })
    await userEvent.click(screen.getByRole('button', { name: 'Test SOS workflow' }))
    const dialog = await screen.findByRole('dialog', { name: /Test SOS workflow/ })
    expect(await within(dialog).findByText('Meera Raman')).toBeInTheDocument()
    expect(within(dialog).getByText(/No email will be sent/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Run dry-run' }))
    expect(await within(dialog).findByText(/No email was sent/)).toBeInTheDocument()
    expect(api.callsTo('POST', '/events')[0].body).toMatchObject({ source: 'simulation', status: 'dry_run' })
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })
})

describe('SosDryRun component', () => {
  it('explains when no guardian is set', async () => {
    setup({ 'GET /guardian': { name: '', email: '', phone: '', relationship: '' } })
    renderApp(<SosDryRun open onClose={() => undefined} />, { mode: 'simulation' })
    expect(await screen.findByText(/No guardian is set up/)).toBeInTheDocument()
  })
})
