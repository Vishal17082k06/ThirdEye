import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  /** Accessible text. Pass an empty string when the spinner sits inside an element that already says what is happening. */
  label?: string
  className?: string
}

const sizes = { sm: 'h-5 w-5', md: 'h-8 w-8', lg: 'h-12 w-12' }

export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps) {
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex items-center', className)}>
      <Loader2 className={cn(sizes[size], 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
