import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { AiAssistance } from './AiAssistance'
import { aiController } from './aiController'

/** The AI page obeys the shared controller (the voice assistant's way in) and reports honestly. */
function stubCamera(getUserMedia: () => Promise<unknown>) {
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(getUserMedia), enumerateDevices: vi.fn(async () => []), addEventListener: vi.fn(), removeEventListener: vi.fn() } })
}

beforeEach(() => {
  mockApi({
    'GET /settings': DEFAULT_SETTINGS,
    'POST /devices/laptop_camera/report': {},
    'POST /events': { id: 1 },
  })
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  aiController.reset()
  vi.unstubAllGlobals()
})

describe('AI page and the voice controller', () => {
  it('starts the camera on request and reports the real status', async () => {
    const track = { stop: vi.fn(), readyState: 'live', addEventListener: vi.fn() }
    stubCamera(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }))
    renderApp(<AiAssistance />, { route: '/ai', mode: 'simulation' })
    await waitFor(() => expect(aiController.getState().mounted).toBe(true))
    let result = { ok: false, message: '' }
    await act(async () => {
      result = await aiController.request('startCamera')
    })
    expect(result).toEqual({ ok: true, message: 'The camera is on.' })
    await waitFor(() => expect(aiController.getState().camera).toBe('active'))
    await act(async () => {
      result = await aiController.request('stopCamera')
    })
    expect(result.message).toBe('The camera is off.')
    expect(track.stop).toHaveBeenCalled()
  })

  it('when the browser blocks the camera it says so and leaves a Start camera prompt on the page', async () => {
    stubCamera(async () => {
      throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
    })
    renderApp(<AiAssistance />, { route: '/ai', mode: 'simulation' })
    await waitFor(() => expect(aiController.getState().mounted).toBe(true))
    let result = { ok: true, message: '' }
    await act(async () => {
      result = await aiController.request('startCamera')
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Camera permission was denied')
    expect(result.message).toContain('Tap Start camera')
    expect(await screen.findByText('Voice assistant asked to start the camera')).toBeInTheDocument()
  })

  it('obstacle detection cannot start without a camera and says why', async () => {
    stubCamera(async () => {
      throw Object.assign(new Error('none'), { name: 'NotFoundError' })
    })
    renderApp(<AiAssistance />, { route: '/ai', mode: 'simulation' })
    await waitFor(() => expect(aiController.getState().mounted).toBe(true))
    let result = { ok: true, message: '' }
    await act(async () => {
      result = await aiController.request('startDetection')
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Obstacle detection was not started')
    expect(result.message).toContain('No camera was found')
  })
})
