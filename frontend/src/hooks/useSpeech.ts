import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '../lib/settings'

export type Risk = 'low' | 'medium' | 'high' | 'critical'
export const RISK_RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2, critical: 3 }

/** The same announcement is not repeated inside this window unless its risk has escalated. */
export const DEDUPE_MS = 6000

interface SpeakOptions {
  /** Cancel anything being spoken first. Used for high and critical warnings. */
  interrupt?: boolean
  /** Speak even if spoken feedback is switched off (explicit "Test voice" buttons). */
  force?: boolean
}

/**
 * Text-to-speech for announcements. It honours Settings > Voice (enabled, feedback, rate, voice).
 *
 * `announce` also de-duplicates: it returns true when the announcement is new (and was spoken if voice is on),
 * false when it was suppressed as a repeat. Callers mirror true results into an aria-live region so
 * screen-reader users hear exactly what sighted users read, even when speech output is off.
 */
export function useSpeech() {
  const settings = useSettings().data?.voice
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  const supported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined'
  const voiceRef = useRef(settings)
  voiceRef.current = settings
  const last = useRef(new Map<string, { at: number; rank: number }>())
  const [speaking, setSpeaking] = useState(false)

  const speak = useCallback(
    (text: string, { interrupt = false, force = false }: SpeakOptions = {}): boolean => {
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false
      const v = voiceRef.current
      if (!force && !(v?.enabled && v.feedback)) return false
      // Low-priority speech never queues behind other speech: it is dropped instead.
      if (!interrupt && !force && synth.speaking) return false
      if (interrupt || force) synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      if (v) {
        u.rate = v.rate
        const chosen = v.voiceName ? synth.getVoices?.().find((x) => x.name === v.voiceName) : undefined
        if (chosen) u.voice = chosen
      }
      u.onstart = () => setSpeaking(true)
      u.onend = () => setSpeaking(false)
      u.onerror = () => setSpeaking(false)
      synth.speak(u)
      return true
    },
    [synth],
  )

  const cancel = useCallback(() => {
    synth?.cancel()
    setSpeaking(false)
  }, [synth])

  const announce = useCallback(
    (text: string, risk: Risk | null, now: number = Date.now()): boolean => {
      const rank = risk ? RISK_RANK[risk] : -1
      const prev = last.current.get(text)
      if (prev && now - prev.at < DEDUPE_MS && rank <= prev.rank) return false
      last.current.set(text, { at: now, rank })
      speak(text, { interrupt: rank >= RISK_RANK.high })
      return true
    },
    [speak],
  )

  const resetDedupe = useCallback(() => last.current.clear(), [])

  // Never leave speech running after the page or hook goes away.
  useEffect(() => () => synth?.cancel(), [synth])

  return { supported, speaking, speak, announce, cancel, resetDedupe, voiceEnabled: !!(settings?.enabled && settings.feedback) }
}
