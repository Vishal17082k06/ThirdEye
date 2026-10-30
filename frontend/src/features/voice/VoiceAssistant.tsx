import { CircleHelp, Keyboard, Mic, MicOff, Send, Square } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, Input } from '../../design'
import { cn } from '../../lib/cn'
import { COMMAND_HELP } from './commands'
import { SHORTCUT_LABEL, VOICE_PRIVACY_NOTICE, useVoiceAssistant } from './voiceContext'

/** The assistant's panel: microphone, what was heard, what it was understood as, the answer, typing and help. */
export function VoiceAssistant() {
  const v = useVoiceAssistant()
  const [text, setText] = useState('')
  const micRef = useRef<HTMLButtonElement>(null)

  // Keyboard users who open the panel land on its main control.
  useEffect(() => {
    micRef.current?.focus({ preventScroll: true })
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t || v.busy) return
    setText('')
    void v.runCommand(t, 'typed')
  }

  const unsupported = v.status === 'unsupported'
  const micUnavailable = !v.enabled || unsupported
  const label = v.listening ? 'Stop listening' : 'Start listening'
  const state = v.listening
    ? 'Listening…'
    : v.status === 'processing'
      ? 'Working on it…'
      : micUnavailable
        ? 'Microphone off'
        : 'Press the microphone and speak'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold text-ink">Voice assistant</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            Shortcut (best effort): <kbd className="bw rounded-md border-line-strong bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-ink">{SHORTCUT_LABEL}</kbd>
          </p>
          <p className="mt-0.5 text-xs text-muted">Some systems use Alt+Shift for another purpose (such as switching keyboard layout). Typed commands always work.</p>
        </div>
      </div>

      {/* Microphone */}
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          {v.listening && (
            <span
              aria-hidden="true"
              className="absolute -inset-1.5 rounded-full border-2 border-danger opacity-70 motion-safe:animate-ping"
            />
          )}
          <button
            ref={micRef}
            type="button"
            onClick={v.toggleListening}
            aria-pressed={v.listening}
            aria-label={label}
            className={cn(
              'bw relative flex h-16 w-16 items-center justify-center rounded-full transition-colors',
              v.listening ? 'border-transparent bg-danger text-white' : 'border-transparent bg-primary text-on-primary hover:bg-primary-hover',
              micUnavailable && 'opacity-70',
            )}
          >
            {v.listening ? <Square className="h-6 w-6" aria-hidden="true" /> : micUnavailable ? <MicOff className="h-7 w-7" aria-hidden="true" /> : <Mic className="h-7 w-7" aria-hidden="true" />}
          </button>
        </div>
        <div className="min-w-0">
          <p className={cn('font-semibold', v.listening ? 'text-danger' : 'text-ink')}>{state}</p>
          <p className="text-sm text-muted">
            {v.listening ? 'Say a command. Press again to stop.' : 'It only listens after you press, one command at a time.'}
          </p>
          {v.interim && <p className="mt-1 truncate text-sm italic text-muted">“{v.interim}”</p>}
        </div>
      </div>

      <p className="text-sm text-muted" data-testid="voice-privacy">
        {VOICE_PRIVACY_NOTICE}
      </p>

      {/* Honest notices */}
      {!v.enabled && (
        <p role="note" className="bw rounded-xl border-line-strong bg-surface-muted p-3 text-sm text-ink">
          The voice assistant is turned off in Settings, so the microphone and spoken replies are off. Typed commands still work.{' '}
          <Link to="/settings" className="font-semibold text-primary underline">
            Open Voice settings
          </Link>
        </p>
      )}
      {v.enabled && unsupported && (
        <p role="note" className="bw rounded-xl border-line-strong bg-surface-muted p-3 text-sm text-ink">
          Voice recognition is not supported in this browser (Firefox does not offer it). Use “Type a command” below; every command works by typing.
        </p>
      )}
      {v.error && !unsupported && v.enabled && (
        <p role="alert" className="bw rounded-xl border-danger bg-danger-soft p-3 text-sm font-semibold text-danger">
          {v.error}
        </p>
      )}

      {/* Latest command */}
      {v.last ? (
        <section aria-label="Latest command" className="bw space-y-2 rounded-xl border-line bg-surface-muted p-3 text-sm">
          <p>
            <span className="font-semibold text-muted">You said: </span>
            <span className="text-ink">{v.last.heard ? `“${v.last.heard}”` : '(no answer heard)'}</span>
          </p>
          <p>
            <span className="font-semibold text-muted">Understood as: </span>
            <span className="text-ink">{v.last.interpreted ?? 'Not understood'}</span>
          </p>
          <p className={cn(!v.last.ok && 'text-danger')}>
            <span className="font-semibold text-muted">Assistant: </span>
            <span className="font-medium text-ink">{v.last.response}</span>
          </p>
        </section>
      ) : (
        <p className="text-sm text-muted">Nothing yet. Press the microphone, or type a command below.</p>
      )}

      {/* Touch alternatives for the assistant's questions */}
      {v.awaiting && (
        <div role="group" aria-label="Answer the assistant" className="flex flex-wrap gap-2">
          {v.awaiting.choices > 0 &&
            Array.from({ length: v.awaiting.choices }, (_, i) => (
              <Button key={i} variant="secondary" onClick={() => void v.runCommand(String(i + 1), 'button')} aria-label={`Choose option ${i + 1}`}>
                {i + 1}
              </Button>
            ))}
          {v.awaiting.choices === 0 && (
            <Button onClick={() => void v.runCommand('yes', 'button')}>Yes</Button>
          )}
          <Button variant="secondary" onClick={() => void v.runCommand(v.awaiting!.choices === 0 ? 'no' : 'cancel', 'button')}>
            {v.awaiting.choices === 0 ? 'No' : 'Cancel'}
          </Button>
        </div>
      )}

      {/* Typed commands: the full keyboard and touch alternative */}
      <form onSubmit={submit} className="space-y-2" aria-label="Command entry">
        <Input
          label="Type a command"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="For example: open dashboard"
          autoComplete="off"
          enterKeyHint="send"
        />
        <Button type="submit" variant="secondary" fullWidth disabled={!text.trim() || v.busy} leftIcon={<Send className="h-5 w-5" aria-hidden="true" />}>
          Run command
        </Button>
      </form>

      {/* History */}
      {v.history.length > 0 && (
        <section aria-label="Recent commands">
          <h3 className="text-sm font-bold text-ink">Recent commands</h3>
          <ol className="mt-1 divide-y divide-line text-sm">
            {v.history.map((h) => (
              <li key={h.id} className="py-1.5">
                <p className="font-medium text-ink">{h.heard ? `“${h.heard}”` : 'No answer'}</p>
                <p className={cn('text-muted', !h.ok && 'text-danger')}>{h.response}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Help */}
      <section>
        <button
          type="button"
          onClick={() => v.setShowHelp(!v.showHelp)}
          aria-expanded={v.showHelp}
          aria-controls="voice-help"
          className="flex min-h-[var(--control-h)] items-center gap-2 font-semibold text-primary underline-offset-2 hover:underline"
        >
          <CircleHelp className="h-5 w-5" aria-hidden="true" />
          {v.showHelp ? 'Hide commands' : 'What can I say?'}
        </button>
        {v.showHelp && (
          <ul id="voice-help" className="mt-1 space-y-1.5 text-sm">
            {COMMAND_HELP.map((c) => (
              <li key={c.label}>
                <span className="font-semibold text-ink">{c.label}</span>
                <span className="block text-muted">Say: “{c.example}”</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
