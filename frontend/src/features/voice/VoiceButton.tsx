import { Mic } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { cn } from '../../lib/cn'
import { useEscapeLayer } from '../../lib/escapeStack'
import { VoiceAssistant } from './VoiceAssistant'
import { SHORTCUT_LABEL, useOptionalVoiceAssistant } from './voiceContext'

/**
 * The Topbar's voice assistant button. It opens the assistant panel; the assistant itself (state, recognition,
 * commands) lives in VoiceProvider so it keeps working while the panel is closed. While the microphone is on the
 * button shows an animated ring (still, but visible, with reduced motion).
 */
export function VoiceButton() {
  const v = useOptionalVoiceAssistant()
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const open = v?.open ?? false
  const setOpen = v?.setOpen

  useEscapeLayer(open, () => {
    setOpen?.(false)
    wrapRef.current?.querySelector<HTMLElement>('[aria-controls]')?.focus()
  })

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen?.(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open, setOpen])

  const listening = v?.listening ?? false
  // What a screen reader hears. The region is always mounted so the first message is not missed.
  const live = listening ? 'Listening… say a command.' : v?.error ?? v?.last?.response ?? ''
  const liveKey = listening ? 'listening' : v?.error ? `e-${v.error}` : `r-${v?.last?.id ?? 0}`

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label="Voice assistant"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        title={`Voice assistant (${SHORTCUT_LABEL})`}
        disabled={!v}
        onClick={() => v?.setOpen(!open)}
        className={cn(
          'bw relative flex h-[var(--control-h)] w-[var(--control-h)] items-center justify-center rounded-xl text-ink hover:bg-surface-muted',
          listening ? 'border-danger bg-danger-soft' : 'border-line-strong bg-surface',
        )}
      >
        {listening && (
          <span aria-hidden="true" className="absolute -inset-1 rounded-2xl border-2 border-danger opacity-70 motion-safe:animate-pulse" />
        )}
        <Mic className={cn('h-5 w-5', listening && 'text-danger')} aria-hidden="true" />
        {listening && <span aria-hidden="true" className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-danger" />}
      </button>

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="voice-live">
        <span key={liveKey}>{live}</span>
      </div>

      {open && v && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Voice assistant"
          className="bw absolute right-0 top-full z-40 mt-2 max-h-[min(80vh,42rem)] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border-line bg-surface p-4 shadow-pop"
        >
          <VoiceAssistant />
        </div>
      )}
    </div>
  )
}
