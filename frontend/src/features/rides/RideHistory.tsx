import { Bike, Car, Footprints, History as HistoryIcon, Ticket, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardHeader, EmptyState, Modal, Spinner, useToast } from '../../design'
import { ApiError } from '../../lib/api'
import { formatDistance, formatDuration } from '../../lib/geo'
import { absoluteTime } from '../../lib/relativeTime'
import { ErrorBanner } from '../auth/FormBanner'
import { useCancelRide, useRides, type Ride } from './api'

const MODE_INFO: Record<Ride['mode'], { label: string; icon: LucideIcon }> = {
  car: { label: 'Car', icon: Car },
  bike: { label: 'Bike', icon: Bike },
  walk: { label: 'Walking', icon: Footprints },
}

export function RideStatusBadge({ status }: { status: Ride['status'] }) {
  return status === 'requested' ? <Badge tone="info">Requested</Badge> : <Badge tone="neutral">Cancelled</Badge>
}

export function SimulatedRideBadge() {
  return (
    <Badge tone="simulation" className="uppercase tracking-wide">
      Simulated
    </Badge>
  )
}

export function FareLine({ ride }: { ride: Pick<Ride, 'mode' | 'fare_estimate' | 'fare_note'> }) {
  if (ride.mode === 'walk' || ride.fare_estimate == null) return <span>No fare for walking</span>
  return (
    <span>
      Fare estimate ₹{ride.fare_estimate} <span className="text-muted">({ride.fare_note ?? 'estimate using demo rates'})</span>
    </span>
  )
}

export function RideHistory() {
  const rides = useRides()
  const cancel = useCancelRide()
  const toast = useToast()
  const [target, setTarget] = useState<Ride | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  async function confirmCancel() {
    if (!target) return
    setCancelError(null)
    try {
      await cancel.mutateAsync(target.id)
      toast.show({ tone: 'success', title: 'Ride request cancelled', message: target.booking_id })
      setTarget(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setCancelError('This request can no longer be cancelled because it is not in the requested state. The list has been refreshed.')
      } else {
        setCancelError(err instanceof ApiError ? err.message : 'The request could not be cancelled. Try again.')
      }
    }
  }

  return (
    <Card as="section" aria-labelledby="hist-h">
      <CardHeader id="hist-h" title="Your ride requests" description="Demo requests made with Third Eye" icon={<HistoryIcon className="h-5 w-5" aria-hidden="true" />} />
      {rides.isLoading ? (
        <p className="flex items-center gap-2 text-muted">
          <Spinner size="sm" label="Loading ride requests" /> Loading your ride requests…
        </p>
      ) : rides.isError ? (
        <div className="space-y-3">
          <ErrorBanner message={rides.error instanceof ApiError ? rides.error.message : 'Ride requests could not be loaded.'} />
          <Button variant="secondary" onClick={() => void rides.refetch()}>
            Try again
          </Button>
        </div>
      ) : rides.data && rides.data.items.length > 0 ? (
        <ul className="space-y-3" aria-label="Ride requests">
          {rides.data.items.map((r) => {
            const m = MODE_INFO[r.mode]
            return (
              <li key={r.id} className="bw space-y-2 rounded-xl border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 font-bold text-ink">
                    <Ticket className="h-5 w-5 text-primary" aria-hidden="true" />
                    {r.booking_id}
                  </p>
                  <span className="flex items-center gap-2">
                    {r.source === 'simulation' && <SimulatedRideBadge />}
                    <RideStatusBadge status={r.status} />
                  </span>
                </div>
                <p className="text-base text-ink">
                  <span className="font-semibold">{r.pickup.label}</span> to <span className="font-semibold">{r.destination.label}</span>
                </p>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span className="inline-flex items-center gap-1">
                    <m.icon className="h-4 w-4" aria-hidden="true" /> {m.label}
                  </span>
                  <span>{formatDistance(r.distance_m)}</span>
                  <span>about {formatDuration(r.duration_s)}</span>
                  <FareLine ride={r} />
                </p>
                <p className="text-xs text-muted">
                  Requested {absoluteTime(r.created_at)}. {r.disclaimer}
                </p>
                {r.status === 'requested' && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCancelError(null)
                      setTarget(r)
                    }}
                    aria-label={`Cancel ride request ${r.booking_id}`}
                  >
                    Cancel request
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState
          icon={<Ticket className="h-6 w-6" aria-hidden="true" />}
          title="No ride requests yet"
          description="When you confirm a ride request it will be listed here."
        />
      )}

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title="Cancel this ride request?"
        description={target ? `${target.booking_id}: ${target.pickup.label} to ${target.destination.label}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Keep request
            </Button>
            <Button variant="danger" onClick={() => void confirmCancel()} loading={cancel.isPending}>
              Yes, cancel request
            </Button>
          </>
        }
      >
        {cancelError && <ErrorBanner message={cancelError} />}
      </Modal>
    </Card>
  )
}
