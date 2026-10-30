import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '../lib/settings'

export type Risk = 'low' | 'medium' | 'high' | 'critical'
export const RISK_RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2, critical: 3 }

/** A hazard that stays in view is repeated: critical every 10 s, high every 15 s. Lower risks refresh after 60 s. */
export const REPEAT_CRITICAL_MS = 10_000
export const REPEAT_HIGH_MS = 15_000
export const REFRESH_MS = 60_000

/** 'new' = text changed or risk escalated; 'repeat' = same hazard still in view; false = suppressed. */
export type Announced = 'new' | 'repeat' | false

/** The same announcement is not repeated inside this window unless its risk has escalated. */
export const DEDUPE_MS = 6000

interface SpeakOptions {
  /** Cancel anything being spoken first. Used for high and critical warnings. */
  interrupt?: boolean
  /** Speak even if spoken feedback is switched off (explicit "Test voice" buttons). */
  force?: boolean
  /** Risk rank of this speech, used to decide who may interrupt whom. */
  rank?: number
}

/**
 * The browser has one speech queue, so every useSpeech instance shares one record of what is being spoken.
 * A lower-risk or unrelated speaker may not cancel an active high/critical announcement from someone else.
 */
interface Active {
  owner: symbol
  rank: number
  utterance: object
}
let active: Active | null = null

/**
 * Text-to-speech for announcements. It honours Settings > Voice (enabled, feedback, rate, voice).
 *
 * `announce` also de-duplicates: it returns true when the announcement is new (and was spoken if voice is on),
 * false when it was suppressed as a repeat. An unchanged announcement is suppressed until its text changes or its
 * risk escalates; the same text is never repeated within 6 s. Callers mirror true results into an aria-live region
 * so screen-reader users hear exactly what sighted users read, even when speech output is off.
 */
export function useSpeech() {
  const settings = useSettings().data?.voice
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  const supported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined'
  const voiceRef = useRef(settings)
  voiceRef.current = settings
  const owner = useRef(Symbol('speech'))
  const recent = useRef(new Map<string, { at: number; rank: number }>())
  const lastOverall = useRef<{ text: string; rank: number; at: number } | null>(null)
  const [speaking, setSpeaking] = useState(false)

  const speak = useCallback(
    (text: string, { interrupt = false, force = false, rank = 0 }: SpeakOptions = {}): boolean => {
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false
      const v = voiceRef.current
      if (!force && !(v?.enabled && v.feedback)) return false
      const busy = synth.speaking && active !== null
      // Low-priority speech never queues behind other speech: it is dropped instead.
      if (!interrupt && !force && synth.speaking) return false
      // An interrupt from another speaker may only cut off speech of strictly lower risk.
      if (!force && interrupt && busy && active!.owner !== owner.current && rank <= active!.rank) return false
      if (interrupt || force) synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      if (v) {
        u.rate = v.rate
        const chosen = v.voiceName ? synth.getVoices?.().find((x) => x.name === v.voiceName) : undefined
        if (chosen) u.voice = chosen
      }
      const mine: Active = { owner: owner.current, rank, utterance: u }
      const done = () => {
        if (active?.utterance === u) active = null
        setSpeaking(false)
      }
      u.onstart = () => setSpeaking(true)
      u.onend = done
      u.onerror = done
      active = mine
      synth.speak(u)
      return true
    },
    [synth],
  )

  /** Cancels speech only if this instance started it. */
  const cancel = useCallback(() => {
    if (active && active.owner === owner.current) {
      synth?.cancel()
      active = null
    }
    setSpeaking(false)
  }, [synth])

  const announce = useCallback(
    (text: string, risk: Risk | null, now: number = Date.now()): Announced => {
      const rank = risk ? RISK_RANK[risk] : -1
      const last = lastOverall.current
      if (last && last.text === text && rank <= last.rank) {
        // Unchanged scene. Serious hazards are repeated while they stay in view; others are only refreshed rarely.
        const every = rank >= RISK_RANK.critical ? REPEAT_CRITICAL_MS : rank >= RISK_RANK.high ? REPEAT_HIGH_MS : REFRESH_MS
        if (now - last.at < every) return false
        // A repeat never interrupts or queues behind other speech; if the speaker is busy, try again next time.
        if (synth?.speaking) return false
        lastOverall.current = { text, rank: Math.max(rank, last.rank), at: now }
        speak(text, { interrupt: false, rank: Math.max(rank, 0) })
        return 'repeat'
      }
      const prev = recent.current.get(text)
      if (prev && now - prev.at < DEDUPE_MS && rank <= prev.rank) return false
      recent.current.set(text, { at: now, rank })
      lastOverall.current = { text, rank, at: now }
      speak(text, { interrupt: rank >= RISK_RANK.high, rank: Math.max(rank, 0) })
      return 'new'
    },
    [speak, synth],
  )

  const resetDedupe = useCallback(() => {
    recent.current.clear()
    lastOverall.current = null
  }, [])

  // Never leave this instance's speech running after the page or hook goes away.
  useEffect(() => {
    const me = owner.current
    return () => {
      if (active?.owner === me) {
        synth?.cancel()
        active = null
      }
    }
  }, [synth])

  return { supported, speaking, speak, announce, cancel, resetDedupe, voiceEnabled: !!(settings?.enabled && settings.feedback) }
}
