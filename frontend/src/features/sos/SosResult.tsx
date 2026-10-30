import { AlertCircle, CheckCircle2, Phone, RotateCcw } from 'lucide-react'
import { Button, Spinner, buttonClasses } from '../../design'
import { cn } from '../../lib/cn'
import { telHref, type SosRecord } from './api'

interface SosResultProps {
  record: SosRecord | null
  /** Set when the request itself failed, so no record exists. */
  error: string | null
  busy: boolean
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
export function SosResult({ record, error, busy, guardianPhone, onRetry }: SosResultProps) {
  let body = null
  if (error) {
    body = (
      <div className="bw space-y-3 rounded-2xl border-danger bg-danger-soft p-5 text-danger">
        <p className="flex items-start gap-3 text-lg font-bold">
          <AlertCircle className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
          <span>Alert not sent. {error}</span>
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <CallLink phone={guardianPhone} />
        </div>
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
  return (
    <div aria-live="polite" aria-atomic="true" data-testid="sos-result">
      {body}
    </div>
  )
}
