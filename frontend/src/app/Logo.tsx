import { cn } from '../lib/cn'

/** Third Eye mark: an eye whose iris is the product's cyan. Mirrors public/favicon.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-9 w-9 shrink-0', className)} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="var(--primary)" />
      <path d="M6 32C13 20 22 14 32 14s19 6 26 18c-7 12-16 18-26 18S13 44 6 32Z" fill="#fff" />
      <circle cx="32" cy="32" r="10.5" fill="#0891B2" />
      <circle cx="32" cy="32" r="5" fill="#0F172A" />
      <circle cx="35" cy="29" r="1.8" fill="#fff" />
    </svg>
  )
}

export function Brand({ textClassName }: { textClassName?: string }) {
  return (
    <span className="flex items-center gap-3">
      <LogoMark />
      <span className={cn('text-xl font-extrabold tracking-tight text-ink', textClassName)}>Third Eye</span>
    </span>
  )
}
