import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type BadgeTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'simulation'
  | 'hardware'
  | 'live'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-muted border-line-strong',
  info: 'bg-primary-soft text-primary border-primary',
  success: 'bg-success-soft text-success border-success',
  warning: 'bg-warning-soft text-warning border-warning',
  danger: 'bg-danger-soft text-danger border-danger',
  simulation: 'bg-sim-soft text-sim border-sim',
  hardware: 'bg-accent-soft text-accent-ink border-accent-ink',
  live: 'bg-success-soft text-success border-success',
}

interface BadgeProps {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}

/** Status is always conveyed by text (and optionally an icon), never by colour alone. */
export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'bw inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-sm font-semibold',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
