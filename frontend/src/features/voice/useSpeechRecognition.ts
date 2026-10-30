import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A thin wrapper over the browser's SpeechRecognition (Chrome, Edge, Safari). It listens for ONE utterance per
 * start(): it stops by itself after a result. It never records or stores audio; the browser's speech service turns
 * speech into text and only that text reaches the app. Recognition only starts when start() is called, which the
 * app does only from a button press or keyboard shortcut.
 */
export type RecognitionStatus = 'unsupported' | 'idle' | 'listening' | 'processing' | 'error'

/* The DOM lib has no types for this API; this is the small part we use. */
interface RecognitionAlternative {
  transcript: string
}
interface RecognitionResultItem {
  isFinal: boolean
  0: RecognitionAlternative
}
interface RecognitionEvent {
  results: ArrayLike<RecognitionResultItem>
}
interface RecognitionErrorEvent {
  error: string
}
export interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => RecognitionLike

export const PRIMARY_LANG = 'en-IN'
export const FALLBACK_LANG = 'en-US'

export const UNSUPPORTED_MESSAGE =
  'Voice recognition is not supported in this browser (Firefox does not offer it). Use the "Type a command" box instead; every command works by typing.'

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Human wording for a SpeechRecognition error code. */
export function describeRecognitionError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was denied. Allow microphone access in your browser settings, or type a command instead.'
    case 'no-speech':
      return 'I did not hear anything. Press the microphone and try again.'
    case 'audio-capture':
      return 'No microphone was found, or it could not be used. Check that one is connected, or type a command instead.'
    case 'network':
      return 'Voice recognition needs an internet connection and could not reach the speech service. Type a command instead.'
    case 'language-not-supported':
      return 'This browser does not support the speech language. Type a command instead.'
    default:
      return 'Voice recognition stopped because of an error. Try again or type a command.'
  }
}

interface Options {
  /** Called once with the final transcript of an utterance. */
  onFinal: (transcript: string) => void
}

export function useSpeechRecognition({ onFinal }: Options) {
  const Ctor = getRecognitionCtor()
  const [status, setStatus] = useState<RecognitionStatus>(Ctor ? 'idle' : 'unsupported')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<RecognitionLike | null>(null)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal
  const langRef = useRef(PRIMARY_LANG)

  const teardown = useCallback(() => {
    const r = recRef.current
    recRef.current = null
    if (!r) return
    r.onstart = r.onresult = r.onerror = r.onend = null
    try {
      r.abort()
    } catch {
      /* already stopped */
    }
  }, [])

  const begin = useCallback(() => {
    const C = getRecognitionCtor()
    if (!C) {
      setStatus('unsupported')
      return
    }
    teardown()
    const rec = new C()
    rec.lang = langRef.current
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1
    let gotFinal = false
    let failed = false
    let retrying = false

    rec.onstart = () => setStatus('listening')
    rec.onresult = (e) => {
      let text = ''
      let final = false
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript
        if (e.results[i].isFinal) final = true
      }
      text = text.trim()
      if (!final) {
        setInterim(text)
        return
      }
      if (gotFinal) return
      gotFinal = true
      setInterim(text)
      setStatus('processing')
      // One utterance per press: stop now rather than keep the microphone open.
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
      if (text) onFinalRef.current(text)
    }
    rec.onerror = (e) => {
      if (e.error === 'aborted') return
      if (e.error === 'language-not-supported' && langRef.current !== FALLBACK_LANG) {
        // en-IN is not available here: quietly try en-US once.
        langRef.current = FALLBACK_LANG
        retrying = true
        setTimeout(() => {
          if (recRef.current === rec) begin()
        }, 0)
        return
      }
      failed = true
      setError(describeRecognitionError(e.error))
      setStatus('error')
    }
    rec.onend = () => {
      if (retrying) return
      if (recRef.current === rec) recRef.current = null
      setInterim('')
      setStatus((s) => (failed || s === 'error' ? 'error' : 'idle'))
    }

    recRef.current = rec
    setError(null)
    setInterim('')
    try {
      rec.start()
    } catch {
      setError(describeRecognitionError('other'))
      setStatus('error')
    }
  }, [teardown])

  /** Must be called from a user gesture (button press or keyboard shortcut). */
  const start = useCallback(() => {
    if (!getRecognitionCtor()) {
      setStatus('unsupported')
      return
    }
    begin()
  }, [begin])

  const stop = useCallback(() => {
    teardown()
    setInterim('')
    setStatus((s) => (s === 'unsupported' ? s : 'idle'))
  }, [teardown])

  // The microphone is never left open when the app goes away.
  useEffect(() => teardown, [teardown])

  return { status, supported: !!Ctor, interim, error, start, stop }
}
