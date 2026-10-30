import { AlertCircle, CheckCircle2, Phone, RotateCcw } from 'lucide-react'
import { Button, Spinner, buttonClasses } from '../../design'
import { cn } from '../../lib/cn'
import { useEffect, useState } from 'react'
import { telHref, type SosRecord } from './api'
import type { SosError } from './SosProvider'

interface SosResultProps {
  record: SosRecord | null
  /** Set when the request itself failed, so no record exists. */
  error: SosError | null
  busy: boolean
  /** A request is in flight and no record has come back yet. */
  sending: { startedAt: number | null; waitingForLocation: boolean } | null
  onSendAgain: () => void
  /** 'dialog' has no history on screen, so it points to the Emergency SOS page instead of "below". */
  where?: 'dialog' | 'page'
  /** The same content was already announced by the dialog: keep it visible but do not announce it again. */
  silent?: boolean
  guardianPhone: string | null
  onRetry: (id: number) => void
}

function locationLine(r: SosRecord): string {
  if (r.lat == null || r.lon == null) return 'No location was included in the email.'
  return r.accuracy_m != null ? `Your location was included (accurate to about ${Math.round(r.accuracy_m)} m).` : 'Your location was included.'
}

function CallLink({ phone }: { phone: string | null }) {
  const href = telHref(phone)
  if (!href) return null
  return (
    <a href={href} className={cn(buttonClasses('secondary'), 'min-h-14 text-lg')}>
      <Phone className="h-5 w-5" aria-hidden="true" />
      Call your guardian
    </a>
  )
}

/**
 * The honest outcome of an alert. Success wording is only ever produced for a server status of 'sent'.
 * The live region stays mounted so a screen reader announces each change.
 */
function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span>{since ? Math.max(0, Math.floor((now - since) / 1000)) : 0} s</span>
}

function unknownText(message: string, where: 'dialog' | 'page'): string {
  return where === 'dialog' ? message.replace('check SOS history below.', 'check the SOS history on the Emergency SOS page.') : message
}

export function SosResult({ record, error, busy, sending, guardianPhone, onRetry, onSendAgain, where = 'page', silent = false }: SosResultProps) {
  let body = null
  if (error) {
    const unknown = error.kind === 'unknown'
    body = (
      <div className="bw space-y-3 rounded-2xl border-danger bg-danger-soft p-5 text-danger">
        <p className="flex items-start gap-3 text-lg font-bold">
          <AlertCircle className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
          <span>{unknown ? unknownText(error.message, where) : error.message}</span>
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <CallLink phone={guardianPhone} />
          {unknown && (
            <Button variant="secondary" className="min-h-14 text-lg" loading={busy} onClick={onSendAgain}>
              Send again (may send a duplicate)
            </Button>
          )}
        </div>
      </div>
    )
  } else if (!record && sending) {
    body = (
      <div className="bw space-y-2 rounded-2xl border-warning bg-warning-soft p-5 text-warning">
        <p className="flex items-center gap-3 text-lg font-bold">
          <Spinner size="sm" label="" />
          <span>{sending.waitingForLocation ? 'Sending without location in a moment…' : 'Sending…'}</span>
        </p>
        <p className="font-semibold">This can take up to a minute.</p>
      </div>
    )
  } else if (record?.status === 'sent') {
    const to = [record.guardian_name, record.guardian_email].filter(Boolean).join(' ')
    body = (
      <div className="bw space-y-2 rounded-2xl border-success bg-success-soft p-5 text-success">
        <p className="flex items-start gap-3 text-lg font-bold">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
          <span>
            Email accepted by the mail server for delivery to {to}. This confirms hand-off, not that it was read.
          </span>
        </p>
        <p className="font-semibold">{locationLine(record)}</p>
      </div>
    )
  } else if (record?.status === 'failed') {
    body = (
      <div className="bw space-y-3 rounded-2xl border-danger bg-danger-soft p-5 text-danger">
        <p className="flex items-start gap-3 text-lg font-bold">
          <AlertCircle className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
          <span>Alert NOT delivered. {record.delivery_message}</span>
        </p>
        <p className="font-semibold">Contact your guardian directly if this is an emergency.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {record.retry_available && (
            <Button variant="danger" className="min-h-14 text-lg" loading={busy} onClick={() => onRetry(record.id)}>
              {!busy && <RotateCcw className="h-5 w-5" aria-hidden="true" />}
              Retry sending
            </Button>
          )}
          <CallLink phone={guardianPhone} />
        </div>
      </div>
    )
  } else if (record?.status === 'pending') {
    body = (
      <div className="bw space-y-3 rounded-2xl border-warning bg-warning-soft p-5 text-warning">
        <p className="flex items-center gap-3 text-lg font-bold">
          {!record.retry_available && <Spinner size="sm" label="" />}
          <span>{record.retry_available ? record.delivery_message : 'Sending…'}</span>
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {record.retry_available && (
            <Button variant="danger" className="min-h-14 text-lg" loading={busy} onClick={() => onRetry(record.id)}>
              Retry sending
            </Button>
          )}
          <CallLink phone={guardianPhone} />
        </div>
      </div>
    )
  }
  // One announcement mechanism: this polite status region. The ticking counter lives outside it, hidden from assistive tech.
  return (
    <>
      <div role="status" aria-live={silent ? 'off' : 'polite'} aria-atomic="true" data-testid="sos-result">
        {body}
      </div>
      {!record && !error && sending && (
        <p aria-hidden="true" data-testid="sos-elapsed" className="mt-2 text-sm font-semibold text-muted">
          Elapsed <Elapsed since={sending.startedAt} />
        </p>
      )}
    </>
  )
}
