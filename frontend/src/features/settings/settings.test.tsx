import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { Settings } from './Settings'

const PROFILE = { id: 1, name: 'Asha', email: 'a@b.co', phone: '+919876543210', age: null }
const GUARDIAN = { name: 'Ravi', email: 'r@b.co', phone: '9876543210', relationship: 'Parent' }

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /profile': PROFILE,
    'GET /guardian': GUARDIAN,
    'GET /settings': DEFAULT_SETTINGS,
    'GET /settings/email-status': { configured: false },
    ...extra,
  }
}

const speak = vi.fn()
const cancel = vi.fn()

beforeEach(() => {
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [{ name: 'Test Voice', lang: 'en-IN' }],
    speak,
    cancel,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string
      rate = 1
      voice: unknown = null
      constructor(text: string) {
        this.text = text
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  speak.mockClear()
  cancel.mockClear()
  for (const a of ['data-contrast', 'data-text', 'data-buttons']) document.documentElement.removeAttribute(a)
  localStorage.clear()
})

describe('Settings page', () => {
  it('accessibility: previews immediately, saves to the server, caches locally', async () => {
    const api = mockApi(
      routes({
        'PUT /settings': (b: unknown) => ({
          ...DEFAULT_SETTINGS,
          accessibility: { ...DEFAULT_SETTINGS.accessibility, ...(b as { accessibility: object }).accessibility },
        }),
      }),
    )
    renderApp(<Settings />)
    await userEvent.selectOptions(await screen.findByLabelText('Text size'), 'xl')
    await userEvent.click(screen.getByRole('switch', { name: 'High contrast' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Large buttons' }))
    const root = document.documentElement
    expect(root).toHaveAttribute('data-text', 'xl')
    expect(root).toHaveAttribute('data-contrast', 'high')
    expect(root).toHaveAttribute('data-buttons', 'large')

    await userEvent.click(screen.getByRole('button', { name: 'Save accessibility' }))
    expect(await screen.findByText('Accessibility settings saved')).toBeInTheDocument()
    expect(api.callsTo('PUT', '/settings')[0].body).toEqual({
      accessibility: { textSize: 'xl', highContrast: true, largeButtons: true },
    })
    expect(JSON.parse(localStorage.getItem('thirdeye.a11y')!)).toEqual({
      textSize: 'xl',
      highContrast: true,
      largeButtons: true,
    })
  })

  it('voice: Test voice really speaks with the chosen rate', async () => {
    mockApi(routes())
    renderApp(<Settings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Test voice' }))
    expect(cancel).toHaveBeenCalled()
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0][0].rate).toBe(1)
  })

  it('emergency: states honestly that email is not configured', async () => {
    mockApi(routes())
    renderApp(<Settings />)
    expect(await screen.findByText(/Not configured: SOS emails cannot be sent/)).toBeInTheDocument()
    expect(await screen.findByText(/Ravi \(Parent\)/)).toBeInTheDocument()
  })

  it('hardware: rejects an invalid IP and does not call the server', async () => {
    const api = mockApi(routes())
    renderApp(<Settings />)
    const ip = await screen.findByLabelText('Default hardware IP or hostname')
    await userEvent.type(ip, '999.1.1.1')
    await userEvent.click(screen.getByRole('button', { name: 'Save hardware' }))
    expect(screen.getByText('Each part of an IP address must be between 0 and 255.')).toBeInTheDocument()
    // The save handler is async: wait until the button leaves its loading state, then assert nothing was sent.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save hardware' })).not.toHaveAttribute('aria-busy'))
    expect(api.callsTo('PUT', '/settings')).toHaveLength(0)
  })

  it('hardware: trailing spaces alone do not count as an unsaved change', async () => {
    mockApi(routes({ 'GET /settings': { ...DEFAULT_SETTINGS, hardware: { ...DEFAULT_SETTINGS.hardware, deviceIp: '192.168.1.5' } } }))
    renderApp(<Settings />)
    const ip = await screen.findByLabelText('Default hardware IP or hostname')
    await userEvent.type(ip, '  ')
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    await userEvent.type(ip, '9')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('ai: the rule and the message agree (danger 0.1 to 20 m, caution above danger)', async () => {
    const api = mockApi(routes({ 'PUT /settings': DEFAULT_SETTINGS }))
    renderApp(<Settings />)
    const danger = await screen.findByLabelText('Danger distance (m)')
    await userEvent.clear(danger)
    await userEvent.type(danger, '0.05')
    await userEvent.click(screen.getByRole('button', { name: 'Save ai' }))
    expect(screen.getByText('Enter a distance from 0.1 to 20 metres.')).toBeInTheDocument()
    expect(api.callsTo('PUT', '/settings')).toHaveLength(0)
    await userEvent.clear(danger)
    await userEvent.type(danger, '0.1')
    await userEvent.click(screen.getByRole('button', { name: 'Save ai' }))
    expect(await screen.findByText('AI settings saved')).toBeInTheDocument()
  })

  it('resyncs a clean section when fresh settings arrive', async () => {
    let doc = DEFAULT_SETTINGS
    mockApi(routes({ 'GET /settings': () => doc }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderApp(<Settings />, { queryClient: client })
    await screen.findByLabelText('Polling interval (ms)')
    doc = { ...DEFAULT_SETTINGS, hardware: { ...DEFAULT_SETTINGS.hardware, pollingIntervalMs: 2500 } }
    await client.refetchQueries({ queryKey: ['settings'] })
    expect(await screen.findByDisplayValue('2500')).toBeInTheDocument()
  })

  it('camera: without permission shows a grant button that requests then re-enumerates', async () => {
    mockApi(routes())
    const stop = vi.fn()
    let granted = false
    const enumerateDevices = vi.fn(async () => [
      { kind: 'videoinput', deviceId: 'cam1', label: granted ? 'HD Webcam' : '' },
    ])
    const getUserMedia = vi.fn(async () => {
      granted = true
      return { getTracks: () => [{ stop }] }
    })
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia, enumerateDevices } })
    renderApp(<Settings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Grant camera permission' }))
    expect(await screen.findByRole('option', { name: 'HD Webcam' })).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalled()
    expect(stop).toHaveBeenCalled()
    expect(enumerateDevices).toHaveBeenCalledTimes(2)
  })
})
