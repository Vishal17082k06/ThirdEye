import { History as HistoryIcon, MapPinOff } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Spinner } from '../../design'
import { absoluteTime, relativeTime } from '../../lib/relativeTime'
import { ErrorBanner } from '../auth/FormBanner'
import { safeMapsLink, useSosHistory, type SosRecord } from './api'

function StatusBadge({ r }: { r: SosRecord }) {
  if (r.status === 'sent') return <Badge tone="success">Sent: accepted by mail server</Badge>
  if (r.status === 'failed') return <Badge tone="danger">Failed: not delivered</Badge>
  return <Badge tone="warning">{r.retry_available ? 'Stuck: may not have sent' : 'Sending…'}</Badge>
}

function Row({ r, onRetry, retrying }: { r: SosRecord; onRetry: (id: number) => void; retrying: boolean }) {
  return (
    <li className="space-y-2 py-4" data-testid="sos-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge r={r} />
        <time dateTime={r.created_at} title={absoluteTime(r.created_at)} className="text-base font-semibold text-ink">
          {absoluteTime(r.created_at)}
        </time>
        <span className="text-sm text-muted">({relativeTime(r.created_at)})</span>
      </div>
      <p className="text-base text-ink">{r.delivery_message}</p>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        {safeMapsLink(r.maps_link) ? (
          <a href={safeMapsLink(r.maps_link) ?? undefined} target="_blank" rel="noopener noreferrer" className="font-bold text-primary underline underline-offset-4">
            Open in Google Maps
          </a>
        ) : (
          <span className="inline-flex items-center gap-1">
            <MapPinOff className="h-4 w-4" aria-hidden="true" /> No location sent
          </span>
        )}
        <span>
          {r.attempts} {r.attempts === 1 ? 'attempt' : 'attempts'}
        </span>
        {r.guardian_name && <span>To {r.guardian_name}</span>}
      </p>
      {r.note && <p className="text-sm text-muted">Your note: {r.note}</p>}
      {r.retry_available && (
        <Button variant="secondary" loading={retrying} onClick={() => onRetry(r.id)} className="min-h-12">
          Retry
        </Button>
      )}
    </li>
  )
}

export function SosHistory({ onRetry, retryingId }: { onRetry: (id: number) => void; retryingId: number | null }) {
  const q = useSosHistory()
  const items = q.data?.items ?? []
  return (
    <Card as="section" aria-labelledby="sos-hist-h">
      <CardHeader id="sos-hist-h" title="SOS history" description="Every alert and what the mail server reported" icon={<HistoryIcon className="h-5 w-5" aria-hidden="true" />} />
      {q.isLoading ? (
        <p className="flex items-center gap-2 text-muted">
          <Spinner size="sm" label="Loading SOS history" /> Loading SOS history…
        </p>
      ) : q.isError ? (
        <div className="space-y-3">
          <ErrorBanner message="SOS history could not be loaded." />
          <Button variant="secondary" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No SOS alerts yet" description="When you send an emergency alert it is listed here with its delivery result." />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((r) => (
            <Row key={r.id} r={r} onRetry={onRetry} retrying={retryingId === r.id} />
          ))}
        </ul>
      )}
    </Card>
  )
}
