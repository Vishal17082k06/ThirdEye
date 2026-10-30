import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const base =
  'bw inline-flex min-h-[var(--control-h)] items-center justify-center gap-2 rounded-xl px-5 py-2 text-base font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60'

const variants: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-on-primary hover:bg-primary-hover shadow-card',
  secondary: 'border-line-strong bg-surface text-ink hover:bg-surface-muted',
  ghost: 'border-transparent text-primary hover:bg-primary-soft',
  danger: 'border-transparent bg-danger text-white hover:brightness-90',
}

/** Class string so links (react-router <Link>) can look exactly like buttons. */
export function buttonClasses(variant: ButtonVariant = 'primary', fullWidth = false): string {
  return cn(base, 'whitespace-nowrap', variants[variant], fullWidth && 'w-full')
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
  fullWidth?: boolean
  leftIcon?: ReactNode
}

export function Button({
  variant = 'primary',
  loading = false,
  fullWidth = false,
  leftIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses(variant, fullWidth), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size="sm" label="" /> : leftIcon}
      {children}
    </button>
  )
}
