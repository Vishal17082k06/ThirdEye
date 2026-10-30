import { Eye, EyeOff } from 'lucide-react'
import { useId, useState, type InputHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  hint?: string
  error?: string
  /** Adds a show/hide button. Only meaningful with type="password". */
  revealable?: boolean
}

export const fieldClasses =
  'bw min-h-[var(--control-h)] w-full rounded-xl bg-surface px-4 py-2 text-base text-ink placeholder:text-muted'

export function Input({ label, hint, error, revealable, type = 'text', id, className, ...rest }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const [revealed, setRevealed] = useState(false)
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined
  const canReveal = revealable && type === 'password'

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-base font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={canReveal && revealed ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            fieldClasses,
            error ? 'border-danger' : 'border-line-strong',
            canReveal && 'pr-14',
            className,
          )}
          {...rest}
        />
        {canReveal && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label="Show password"
            aria-pressed={revealed}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted hover:text-ink"
          >
            {revealed ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
          </button>
        )}
      </div>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
