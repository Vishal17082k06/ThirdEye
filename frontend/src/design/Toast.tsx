import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  message?: string
}

interface ToastApi {
  show: (toast: { tone?: ToastTone; title: string; message?: string; durationMs?: number }) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const toneStyles: Record<ToastTone, { box: string; icon: ReactNode }> = {
  success: { box: 'border-success', icon: <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" /> },
  error: { box: 'border-danger', icon: <XCircle className="h-5 w-5 text-danger" aria-hidden="true" /> },
  warning: { box: 'border-warning', icon: <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" /> },
  info: { box: 'border-primary', icon: <Info className="h-5 w-5 text-primary" aria-hidden="true" /> },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const show = useCallback<ToastApi['show']>(
    ({ tone = 'info', title, message, durationMs = 6000 }) => {
      const id = nextId.current++
      setToasts((t) => [...t, { id, tone, title, message }])
      window.setTimeout(() => dismiss(id), durationMs)
    },
    [dismiss],
  )

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Live regions are always mounted so screen readers announce additions. Errors are assertive. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        <div role="status" aria-live="polite" className="flex w-full max-w-sm flex-col gap-2">
          {toasts
            .filter((t) => t.tone !== 'error')
            .map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
            ))}
        </div>
        <div role="alert" aria-live="assertive" className="flex w-full max-w-sm flex-col gap-2">
          {toasts
            .filter((t) => t.tone === 'error')
            .map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const style = toneStyles[toast.tone]
  return (
    <div
      className={cn(
        'bw pointer-events-auto flex items-start gap-3 rounded-xl bg-surface p-4 shadow-pop',
        style.box,
      )}
    >
      <span className="mt-0.5">{style.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{toast.title}</p>
        {toast.message && <p className="text-sm text-muted">{toast.message}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-2 flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:text-ink"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
