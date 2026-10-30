import { useId } from 'react'
import { cn } from '../lib/cn'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const labelId = useId()
  const descId = useId()
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <span id={labelId} className="block text-base font-semibold text-ink">
          {label}
        </span>
        {description && (
          <span id={descId} className="block text-sm text-muted">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex min-h-[var(--control-h)] min-w-[var(--control-h)] shrink-0 items-center justify-center disabled:opacity-60"
      >
        <span
          className={cn(
            'bw relative inline-flex h-8 w-14 items-center rounded-full border-transparent transition-colors',
            checked ? 'bg-primary' : 'bg-line-strong',
          )}
        >
          <span
            className={cn(
              'absolute h-6 w-6 rounded-full bg-white shadow transition-transform',
              checked ? 'translate-x-7' : 'translate-x-1',
            )}
          />
        </span>
      </button>
    </div>
  )
}
