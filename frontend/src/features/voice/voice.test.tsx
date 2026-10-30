import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { aiController } from '../ai/aiController'
import { navigationController } from '../navigation/controller'
import { SosProvider } from '../sos/SosProvider'
import { VoiceButton } from './VoiceButton'
import { VoiceProvider } from './VoiceProvider'

class FakeRecognition {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = true
  interimResults = false
  maxAlternatives = 0
  onstart: (() => void) | null = null
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn(() => this.onstart?.())
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
  constructor() {
    FakeRecognition.instances.push(this)
  }
  say(text: string) {
    this.onresult?.({ results: [{ isFinal: true, 0: { transcript: text } }] })
  }
}

const GANDHIPURAM = { label: 'Gandhipuram, Coimbatore, Tamil Nadu, India', lat: 11.0183, lon: 76.9725, kind: 'suburb' }

function Where() {
  return <p data-testid="path">{useLocation().pathname}</p>
}

function App() {
  return (
    <SosProvider>
      <VoiceProvider>
        <VoiceButton />
        <Where />
        <main>
          <h1>Test</h1>
        </main>
      </VoiceProvider>
    </SosProvider>
  )
}

let spoken: string[]

function install(recognition = true) {
  if (recognition) (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
}

function setup(voice: Partial<typeof DEFAULT_SETTINGS.voice> = {}, extra: Record<string, unknown> = {}) {
  const api = mockApi({
    'GET /settings': { ...DEFAULT_SETTINGS, voice: { ...DEFAULT_SETTINGS.voice, ...voice } },
    'GET /nav/geocode': { results: [GANDHIPURAM], note: null },
    ...extra,
  })
  return { api, ...renderApp(<App />, { route: '/settings', mode: 'simulation' }) }
}

beforeEach(() => {
  spoken = []
  vi.stubGlobal('speechSynthesis', {
    speaking: false,
    speak: vi.fn((u: { text: string }) => spoken.push(u.text)),
    cancel: vi.fn(),
    getVoices: () => [],
  })
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string
      constructor(t: string) {
        this.text = t
      }
    },
  )
})

afterEach(() => {
  FakeRecognition.instances = []
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  delete (window as unknown as Record<string, unknown>).SpeechRecognition
  aiController.reset()
  navigationController.reset()
  vi.unstubAllGlobals()
})

const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Voice assistant' }))
  return screen.getByRole('dialog', { name: 'Voice assistant' })
}

const typeCommand = async (user: ReturnType<typeof userEvent.setup>, panel: HTMLElement, text: string) => {
  await user.type(within(panel).getByLabelText('Type a command'), `${text}{Enter}`)
}

describe('voice assistant UI', () => {
  it('never starts recognition on mount or when the panel opens', async () => {
    install()
    setup()
    const user = userEvent.setup()
    await openPanel(user)
    expect(FakeRecognition.instances).toHaveLength(0)
  })

  it('the microphone button toggles listening with a visible and live-region indicator', async () => {
    install()
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    await user.click(within(panel).getByRole('button', { name: 'Start listening' }))
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(within(panel).getByText('Listening…')).toBeInTheDocument()
    expect(within(screen.getByTestId('voice-live')).getByText(/Listening/)).toBeInTheDocument()
    const stop = within(panel).getByRole('button', { name: 'Stop listening' })
    expect(stop).toHaveAttribute('aria-pressed', 'true')
    await user.click(stop)
    expect(FakeRecognition.instances[0].abort).toHaveBeenCalled()
    expect(within(panel).getByRole('button', { name: 'Start listening' })).toBeInTheDocument()
  })

  it('shows the transcript, the interpreted command and the answer, and speaks it', async () => {
    install()
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    await user.click(within(panel).getByRole('button', { name: 'Start listening' }))
    act(() => FakeRecognition.instances[0].say('open dashboard'))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/dashboard'))
    const latest = await within(panel).findByRole('region', { name: 'Latest command' })
    expect(latest).toHaveTextContent('“open dashboard”')
    expect(latest).toHaveTextContent('Understood as: Open dashboard')
    expect(latest).toHaveTextContent('Opening the dashboard.')
    await waitFor(() => expect(spoken).toContain('Opening the dashboard.'))
  })

  it('says unsupported honestly in browsers without recognition and still runs typed commands', async () => {
    install(false)
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    expect(within(panel).getByText(/not supported in this browser/)).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Start listening' }))
    expect(FakeRecognition.instances).toHaveLength(0)
    await typeCommand(user, panel, 'open navigation')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/navigation'))
    expect(within(panel).getByRole('region', { name: 'Latest command' })).toHaveTextContent('Opening Navigation.')
  })

  it('unknown typed commands show a helpful answer and the command list', async () => {
    install()
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    await typeCommand(user, panel, 'make coffee')
    const latest = await within(panel).findByRole('region', { name: 'Latest command' })
    expect(latest).toHaveTextContent('Sorry, I didn\'t understand "make coffee". Try saying: open dashboard.')
    expect(within(panel).getByText('Start or stop the camera')).toBeInTheDocument()
  })

  it('Alt+Shift+V opens the panel and toggles listening', async () => {
    install()
    setup()
    fireEvent.keyDown(document, { code: 'KeyV', key: 'V', altKey: true, shiftKey: true })
    const panel = await screen.findByRole('dialog', { name: 'Voice assistant' })
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(within(panel).getByText('Listening…')).toBeInTheDocument()
    expect(within(panel).getByText('Alt+Shift+V')).toBeInTheDocument()
    fireEvent.keyDown(document, { code: 'KeyV', key: 'V', altKey: true, shiftKey: true })
    expect(within(panel).getByRole('button', { name: 'Start listening' })).toBeInTheDocument()
  })

  it('does not react to plain V or to extra modifiers', () => {
    install()
    setup()
    fireEvent.keyDown(document, { code: 'KeyV', key: 'v' })
    fireEvent.keyDown(document, { code: 'KeyV', key: 'V', altKey: true, shiftKey: true, ctrlKey: true })
    expect(FakeRecognition.instances).toHaveLength(0)
  })

  it('with voice disabled in Settings the microphone does not start, but typed commands work', async () => {
    install()
    setup({ enabled: false })
    const user = userEvent.setup()
    const panel = await openPanel(user)
    await waitFor(() => expect(within(panel).getByText(/turned off in Settings/)).toBeInTheDocument())
    expect(within(panel).getByRole('link', { name: 'Open Voice settings' })).toHaveAttribute('href', '/settings')
    await user.click(within(panel).getByRole('button', { name: 'Start listening' }))
    fireEvent.keyDown(document, { code: 'KeyV', key: 'V', altKey: true, shiftKey: true })
    expect(FakeRecognition.instances).toHaveLength(0)
    await typeCommand(user, panel, 'open dashboard')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/dashboard'))
    expect(spoken).toEqual([])
  })

  it('shows the microphone-denied message', async () => {
    install()
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    await user.click(within(panel).getByRole('button', { name: 'Start listening' }))
    act(() => FakeRecognition.instances[0].onerror?.({ error: 'not-allowed' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Microphone permission was denied')
  })

  it('"stop listening" spoken stops the microphone', async () => {
    install()
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    await user.click(within(panel).getByRole('button', { name: 'Start listening' }))
    act(() => FakeRecognition.instances[0].say('stop listening'))
    await within(panel).findByRole('region', { name: 'Latest command' })
    expect(within(panel).getByRole('button', { name: 'Start listening' })).toBeInTheDocument()
  })

  it('destination flow works with touch buttons and sets the shared navigation state', async () => {
    install()
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    await typeCommand(user, panel, 'take me to Gandhipuram')
    await waitFor(() =>
      expect(within(panel).getByRole('region', { name: 'Latest command' })).toHaveTextContent('Start navigation to Gandhipuram, Coimbatore? Say yes or no.'),
    )
    expect(navigationController.getState().navigating).toBe(false)
    await user.click(within(panel).getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(navigationController.getState().navigating).toBe(true))
    expect(navigationController.getState().destination?.label).toContain('Gandhipuram')
    expect(screen.getByTestId('path')).toHaveTextContent('/navigation')
  })

  it('keeps the last five commands', async () => {
    install()
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    const box = within(panel).getByLabelText('Type a command')
    for (const c of ['open dashboard', 'open navigation', 'open book a ride', 'open ai assistance', 'go back', 'read screen']) {
      await user.type(box, `${c}{Enter}`)
      await waitFor(() => expect(box).toHaveValue(''))
    }
    await waitFor(() => expect(within(within(panel).getByRole('region', { name: 'Recent commands' })).getAllByRole('listitem')).toHaveLength(5))
  })

  it('read screen reads the page heading', async () => {
    install()
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    await typeCommand(user, panel, 'read the screen')
    await waitFor(() => expect(within(panel).getByRole('region', { name: 'Latest command' })).toHaveTextContent('This is the Test page.'))
  })

  it('queues a camera command until the AI page attaches', async () => {
    install()
    setup()
    const user = userEvent.setup()
    const panel = await openPanel(user)
    await typeCommand(user, panel, 'start camera')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/ai'))
    const handler = vi.fn(async () => ({ ok: true, message: 'The camera is on.' }))
    act(() => {
      aiController.attach(handler)
    })
    await waitFor(() => expect(within(panel).getByRole('region', { name: 'Latest command' })).toHaveTextContent('The camera is on.'))
    expect(handler).toHaveBeenCalledWith('startCamera')
  })
})
