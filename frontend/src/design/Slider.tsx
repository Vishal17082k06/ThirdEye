import { useId, type InputHTMLAttributes } from 'react'

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label: string
  value: number
  onChange: (value: number) => void
  hint?: string
  /** Text shown beside the label, e.g. "1.0x". Defaults to the number. */
  display?: string
}

/** Native range input with a visible numeric value; keyboard and screen readers work out of the box. */
export function Slider({ label, value, onChange, hint, display, id, ...rest }: SliderProps) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="text-base font-semibold text-ink">
          {label}
        </label>
        <output htmlFor={inputId} className="text-base font-bold text-primary">
          {display ?? value}
        </output>
      </div>
      <input
        id={inputId}
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-describedby={hint ? `${inputId}-hint` : undefined}
        className="h-[var(--control-h)] w-full cursor-pointer accent-[var(--primary)]"
        {...rest}
      />
      {hint && (
        <p id={`${inputId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  )
}
