import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'

interface TriggerProps {
  'aria-expanded': boolean
  'aria-controls': string
  'aria-haspopup': 'dialog'
  onClick: () => void
}

interface PopoverProps {
  trigger: (props: TriggerProps, state: { open: boolean }) => ReactNode
  children: (close: () => void) => ReactNode
  /** Accessible name for the panel. */
  label: string
  align?: 'left' | 'right'
  className?: string
}

/** Small disclosure panel: closes on Esc (returning focus to the trigger) and on outside click. */
export function Popover({ trigger, children, label, align = 'right', className }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        wrapRef.current?.querySelector<HTMLElement>('[aria-controls]')?.focus()
      }
    }
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      {trigger(
        {
          'aria-expanded': open,
          'aria-controls': panelId,
          'aria-haspopup': 'dialog',
          onClick: () => setOpen((o) => !o),
        },
        { open },
      )}
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={cn(
            'bw absolute top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border-line bg-surface p-4 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
