import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeRecognitionError, useSpeechRecognition } from './useSpeechRecognition'

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
  say(text: string, isFinal = true) {
    this.onresult?.({ results: [{ isFinal, 0: { transcript: text } }] })
  }
}

afterEach(() => {
  FakeRecognition.instances = []
  vi.unstubAllGlobals()
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  delete (window as unknown as Record<string, unknown>).SpeechRecognition
})

function install() {
  ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
}

describe('useSpeechRecognition', () => {
  it('is unsupported without the API', () => {
    const { result } = renderHook(() => useSpeechRecognition({ onFinal: vi.fn() }))
    expect(result.current.status).toBe('unsupported')
    act(() => result.current.start())
    expect(result.current.status).toBe('unsupported')
  })

  it('does not start on mount', () => {
    install()
    const { result } = renderHook(() => useSpeechRecognition({ onFinal: vi.fn() }))
    expect(result.current.status).toBe('idle')
    expect(FakeRecognition.instances).toHaveLength(0)
  })

  it('listens for one utterance, in en-IN, and stops after the final result', () => {
    install()
    const onFinal = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onFinal }))
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    expect(rec.lang).toBe('en-IN')
    expect(rec.continuous).toBe(false)
    expect(rec.interimResults).toBe(true)
    expect(result.current.status).toBe('listening')
    act(() => rec.say('open dash', false))
    expect(result.current.interim).toBe('open dash')
    expect(onFinal).not.toHaveBeenCalled()
    act(() => rec.say('open dashboard'))
    expect(onFinal).toHaveBeenCalledWith('open dashboard')
    expect(rec.stop).toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('maps errors to human messages', () => {
    install()
    const { result } = renderHook(() => useSpeechRecognition({ onFinal: vi.fn() }))
    act(() => result.current.start())
    act(() => FakeRecognition.instances[0].onerror?.({ error: 'not-allowed' }))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('Microphone permission was denied')
    expect(describeRecognitionError('no-speech')).toContain('did not hear')
    expect(describeRecognitionError('network')).toContain('internet')
    expect(describeRecognitionError('audio-capture')).toContain('microphone')
  })

  it('falls back to en-US when en-IN is not supported', async () => {
    install()
    const { result } = renderHook(() => useSpeechRecognition({ onFinal: vi.fn() }))
    act(() => result.current.start())
    await act(async () => {
      FakeRecognition.instances[0].onerror?.({ error: 'language-not-supported' })
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(FakeRecognition.instances[1].lang).toBe('en-US')
    expect(result.current.status).toBe('listening')
  })

  it('stop() aborts and unmount aborts', () => {
    install()
    const { result, unmount } = renderHook(() => useSpeechRecognition({ onFinal: vi.fn() }))
    act(() => result.current.start())
    const rec = FakeRecognition.instances[0]
    act(() => result.current.stop())
    expect(rec.abort).toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    act(() => result.current.start())
    const rec2 = FakeRecognition.instances[1]
    unmount()
    expect(rec2.abort).toHaveBeenCalled()
  })
})
