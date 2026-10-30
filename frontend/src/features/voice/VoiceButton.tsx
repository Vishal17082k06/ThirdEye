import { Mic } from 'lucide-react'
import { Popover } from '../../design'

/**
 * Global voice assistant button. Task 15 replaces the internals with real
 * speech recognition; the Topbar only depends on this component's name.
 */
export function VoiceButton() {
  return (
    <Popover
      label="Voice assistant"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label="Voice assistant"
          className="bw flex h-[var(--control-h)] w-[var(--control-h)] items-center justify-center rounded-xl border-line-strong bg-surface text-ink hover:bg-surface-muted"
        >
          <Mic className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    >
      {() => (
        <div>
          <p className="font-bold text-ink">Voice assistant</p>
          <p className="mt-1 text-sm text-muted">
            Voice commands are not available yet. The voice assistant arrives in a later release; until then every
            feature can be used with the keyboard, mouse, or touch.
          </p>
        </div>
      )}
    </Popover>
  )
}
