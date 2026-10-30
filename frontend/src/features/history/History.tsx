import { CalendarClock, Cpu, FlaskConical, Radio, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner } from '../../design'
import { ApiError } from '../../lib/api'
import { useMode } from '../../lib/mode'
import { absoluteTime, relativeTime } from '../../lib/relativeTime'
import { ErrorBanner } from '../auth/FormBanner'
import {
  EVENT_TYPES,
  useDebounced,
  useEventsHistory,
  type ActivityEvent,
  type EventSource,
  type EventType,
} from './useEvents'

export function SourceBadge({ source }: { source: EventSource }) {
  if (source === 'simulation')
    return (
      <Badge tone="simulation" icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}>
        Simulation
      </Badge>
    )
  if (source === 'hardware')
    return (
      <Badge tone="hardware" icon={<Cpu className="h-4 w-4" aria-hidden="true" />}>
        Hardware
      </Badge>
    )
  return (
    <Badge tone="live" icon={<Radio className="h-4 w-4" aria-hidden="true" />}>
      Live
    </Badge>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  if (s === 'ok' || s === 'success' || s === 'delivered') return <Badge tone="success">{status === 'ok' ? 'OK' : status}</Badge>
  if (s === 'warning' || s === 'pending') return <Badge tone="warning">{status}</Badge>
  if (s === 'error' || s === 'failed') return <Badge tone="danger">{status}</Badge>
  return <Badge>{status}</Badge>
}

const typeLabel = (t: EventType) => EVENT_TYPES.find((x) => x.value === t)?.label ?? t

function EventDetail({ event, onClose }: { event: ActivityEvent | null; onClose: () => void }) {
  return (
    <Modal open={!!event} onClose={onClose} title={event?.title ?? 'Event'} wide>
      {event && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <SourceBadge source={event.source} />
            <StatusBadge status={event.status} />
            <Badge>{typeLabel(event.type)}</Badge>
          </div>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold text-muted">Time</dt>
            <dd className="text-ink">{absoluteTime(event.created_at)}</dd>
            <dt className="font-semibold text-muted">Event ID</dt>
            <dd className="text-ink">{event.id}</dd>
          </dl>
          <div>
            <h3 className="text-base font-bold text-ink">Details</h3>
            {Object.keys(event.details).length === 0 ? (
              <p className="text-sm text-muted">This event has no extra details.</p>
            ) : (
              <pre
                tabIndex={0}
                aria-label="Event details as JSON"
                className="bw mt-2 max-h-80 overflow-auto rounded-xl border-line bg-surface-muted p-3 text-sm text-ink"
              >
                {JSON.stringify(event.details, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

export function History() {
  const [type, setType] = useState<EventType | ''>('')
  const { mode } = useMode()
  // Each mode opens on its own data: Live never starts on simulation events, Simulation starts on simulation only.
  const defaultSource: EventSource | '' = mode === 'simulation' ? 'simulation' : mode === 'live' ? 'live' : ''
  const [source, setSource] = useState<EventSource | ''>(defaultSource)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ActivityEvent | null>(null)
  const q = useDebounced(search, 300)

  const dateError = from && to && from > to ? 'The start date must be on or before the end date.' : undefined
  const filters = useMemo(() => ({ type, source, q, from, to }), [type, source, q, from, to])
  const query = useEventsHistory(filters, !dateError)
  const items = query.data?.pages.flatMap((p) => p.items) ?? []
  const total = query.data?.pages[0]?.total ?? 0
  const filtered = !!(type || source !== defaultSource || q.trim() || from || to)

  function reset() {
    setType('')
    setSource(defaultSource)
    setFrom('')
    setTo('')
    setSearch('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Activity History</h1>
        <p className="mt-1 text-base text-muted">
          Simulation events are labelled separately from live events and hardware events.
        </p>
      </div>

      <Card as="section" aria-label="Filters">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title or details" />
          <Select label="Event type" value={type} onChange={(e) => setType(e.target.value as EventType | '')}>
            <option value="">All types</option>
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select label="Source" value={source} onChange={(e) => setSource(e.target.value as EventSource | '')}>
            <option value="">All</option>
            <option value="live">Live</option>
            <option value="simulation">Simulation</option>
            <option value="hardware">Hardware</option>
          </Select>
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} error={dateError} onChange={(e) => setTo(e.target.value)} />
          <div className="flex items-end">
            <Button variant="secondary" onClick={reset} disabled={!filtered && !search}>
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

      <section aria-label="Events" aria-busy={query.isFetching}>
        {query.isPending && !dateError && <Spinner label="Loading activity" />}
        {query.isError && (
          <div className="space-y-3">
            <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Could not load activity.'} />
            <Button variant="secondary" onClick={() => query.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {query.isSuccess && items.length === 0 && (
          <Card>
            <EmptyState
              icon={filtered ? <SearchX className="h-6 w-6" aria-hidden="true" /> : <CalendarClock className="h-6 w-6" aria-hidden="true" />}
              title={filtered ? 'No events match these filters' : 'No activity yet'}
              description={filtered ? 'Try a wider date range or clear the filters.' : 'Detections, navigation, rides, SOS and device events will appear here.'}
              action={filtered ? <Button variant="secondary" onClick={reset}>Clear filters</Button> : undefined}
            />
          </Card>
        )}
        {items.length > 0 && (
          <Card padded={false}>
            <p className="px-5 pt-4 text-sm text-muted" role="status">
              Showing {items.length} of {total} events
            </p>
            <ul className="divide-y divide-line">
              {items.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(e)}
                    className="flex min-h-[var(--control-h)] w-full flex-col gap-2 px-5 py-4 text-left hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{e.title}</span>
                      <span className="block text-sm text-muted">
                        {typeLabel(e.type)} ·{' '}
                        <time dateTime={e.created_at} title={absoluteTime(e.created_at)}>
                          {relativeTime(e.created_at)}
                        </time>
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <SourceBadge source={e.source} />
                      <StatusBadge status={e.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="border-t border-line p-4 text-center">
                <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                  Load more
                </Button>
              </div>
            )}
          </Card>
        )}
      </section>

      <EventDetail event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
