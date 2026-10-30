import { useQueries } from '@tanstack/react-query'
import { Bike, Car, CheckCircle2, FlaskConical, Footprints, Info, Ticket, type LucideIcon } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Badge, Button, Card, CardHeader, Spinner } from '../../design'
import { locateOnce, type GeoFailure } from '../../hooks/useGeolocation'
import { ApiError } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatDistance, formatDuration, haversineM } from '../../lib/geo'
import { useMode } from '../../lib/mode'
import { ErrorBanner } from '../auth/FormBanner'
import { fetchRoute, navErrorMessage, rideModeToRoute, useServiceArea, type Place, type RideMode, type RouteResult } from '../maps/api'
import { geoJsonToLatLng } from '../maps/polyline'
import { LocationField } from '../maps/LocationField'
import { MapView, type MapMarker } from '../maps/MapView'
import { usePlace } from '../maps/usePlace'
import { RIDE_DISCLAIMER, useCreateRide, type Ride } from './api'
import { FareLine, RideHistory, RideStatusBadge } from './RideHistory'

const MIN_SEPARATION_M = 50
const SAMPLE_PICKUP: Place = { lat: 11.0183, lon: 76.9725, label: 'Gandhipuram, Coimbatore (sample pickup)' }

const TYPES: Array<{ id: RideMode; label: string; blurb: string; icon: LucideIcon }> = [
  { id: 'car', label: 'Car', blurb: 'Door to door by road', icon: Car },
  { id: 'bike', label: 'Bike', blurb: 'Quicker through traffic', icon: Bike },
  { id: 'walk', label: 'Walking', blurb: 'On foot, no fare', icon: Footprints },
]

export function DisclaimerBanner() {
  return (
    <div role="note" className="bw flex items-start gap-3 rounded-xl border-warning bg-warning-soft p-4 text-warning">
      <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="font-semibold">{RIDE_DISCLAIMER}</p>
    </div>
  )
}

function routeFailure(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? navErrorMessage(err) : 'No route is available.'
}

export function RidesPage() {
  const { mode: appMode } = useMode()
  const simulation = appMode === 'simulation'
  const area = useServiceArea()
  const pickup = usePlace(area)
  const destination = usePlace(area)
  const [picking, setPicking] = useState<'pickup' | 'destination' | null>(null)
  const [type, setType] = useState<RideMode>('car')
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Ride | null>(null)
  const create = useCreateRide()
  const typeName = useId()

  const from = pickup.place
  const to = destination.place
  const tooClose = !!from && !!to && haversineM(from, to) < MIN_SEPARATION_M
  const ready = !!from && !!to && !tooClose

  // One route per ride type, fetched as soon as both places are known so every card can show distance and time.
  const routes = useQueries({
    queries: TYPES.map((t) => ({
      queryKey: ['rides', 'route', from?.lat, from?.lon, to?.lat, to?.lon, t.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchRoute(from!, to!, rideModeToRoute(t.id), signal, area),
      enabled: ready,
      retry: false,
      staleTime: 5 * 60 * 1000,
    })),
  })
  const byType = Object.fromEntries(TYPES.map((t, i) => [t.id, routes[i]])) as Record<RideMode, (typeof routes)[number]>
  const selected = byType[type]
  const selectedRoute: RouteResult | undefined = ready ? selected.data : undefined

  const latLngs = useMemo(() => (selectedRoute ? geoJsonToLatLng(selectedRoute.geometry.coordinates) : []), [selectedRoute])
  const markers: MapMarker[] = []
  if (from) markers.push({ lat: from.lat, lon: from.lon, label: `Pickup: ${from.label}`, kind: 'pickup' })
  if (to) markers.push({ lat: to.lat, lon: to.lon, label: `Destination: ${to.label}`, kind: 'destination' })

  async function useCurrentLocation() {
    setLocateError(null)
    setLocating(true)
    try {
      const fix = await locateOnce()
      await pickup.pin(fix.lat, fix.lon)
    } catch (err) {
      setLocateError((err as GeoFailure).message ?? 'GPS not available.')
    } finally {
      setLocating(false)
    }
  }

  function onMapSelect(lat: number, lon: number) {
    if (picking === 'pickup') void pickup.pin(lat, lon)
    else if (picking === 'destination') void destination.pin(lat, lon)
    setPicking(null)
  }

  async function confirm() {
    if (!from || !to || !selectedRoute) return
    try {
      const ride = await create.mutateAsync({
        pickup: from,
        destination: to,
        mode: type,
        distance_m: selectedRoute.distance_m,
        duration_s: selectedRoute.duration_s,
      })
      setConfirmed(ride)
    } catch {
      /* the error is shown from create.error */
    }
  }

  function bookAnother() {
    setConfirmed(null)
    create.reset()
    pickup.clear()
    destination.clear()
  }

  const summaryStatus = [
    from ? `Pickup: ${from.label}.` : 'No pickup chosen yet.',
    to ? `Destination: ${to.label}.` : 'No destination chosen yet.',
    selectedRoute ? `${TYPES.find((t) => t.id === type)?.label}: ${formatDistance(selectedRoute.distance_m)}, about ${formatDuration(selectedRoute.duration_s)} (estimated).` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const submitError =
    create.error instanceof ApiError ? create.error.message : create.error ? 'The request could not be sent. Try again.' : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Book a Ride</h1>
        <p className="mt-1 text-base text-muted">Request a demo ride inside Coimbatore. Pick up, drop off, and choose how you travel.</p>
      </div>

      <DisclaimerBanner />

      {simulation && (
        <div role="note" className="bw flex items-start gap-3 rounded-xl border-sim bg-sim-soft p-4 text-sim">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="font-semibold">SIMULATION MODE. Your device&apos;s GPS is not used here; choose pickup yourself or use the sample pickup.</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <MapView
            area={area}
            markers={markers}
            route={latLngs}
            onSelect={picking ? onMapSelect : undefined}
            selecting={picking ? `Click the map to set the ${picking}` : null}
            className="h-[20rem] sm:h-[28rem] lg:h-[34rem]"
            ariaLabel="Map of Coimbatore showing your ride route"
          />
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {summaryStatus}
          </p>
        </div>

        <div className="space-y-4">
          {confirmed ? (
            <Card as="section" aria-labelledby="done-h" className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                  <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                </span>
                <div>
                  <h2 id="done-h" className="text-xl font-extrabold text-ink">
                    Ride request recorded
                  </h2>
                  <p className="text-sm text-muted">Saved as a demo request. Nobody has been sent to pick you up.</p>
                </div>
              </div>
              <dl className="bw grid grid-cols-2 gap-3 rounded-xl border-line bg-surface-muted p-4">
                <div>
                  <dt className="text-sm text-muted">Booking ID</dt>
                  <dd className="text-lg font-extrabold text-ink">{confirmed.booking_id}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Status</dt>
                  <dd>
                    <RideStatusBadge status={confirmed.status} />
                  </dd>
                </div>
                <div className="col-span-2 text-base text-ink">
                  <span className="font-semibold">{confirmed.pickup.label}</span> to <span className="font-semibold">{confirmed.destination.label}</span>
                </div>
                <div className="col-span-2 text-base text-ink">
                  {formatDistance(confirmed.distance_m)}, about {formatDuration(confirmed.duration_s)} · <FareLine ride={confirmed} />
                </div>
              </dl>
              <p className="text-sm text-muted">{confirmed.disclaimer}</p>
              <Button onClick={bookAnother}>Make another request</Button>
            </Card>
          ) : (
            <Card as="section" aria-labelledby="book-h" className="space-y-5">
              <CardHeader id="book-h" title="Where to?" icon={<Ticket className="h-5 w-5" aria-hidden="true" />} />

              <LocationField
                label="Pickup"
                area={area}
                state={pickup}
                picking={picking === 'pickup'}
                onTogglePick={() => setPicking((p) => (p === 'pickup' ? null : 'pickup'))}
                useCurrent={
                  simulation
                    ? { label: 'Use sample pickup (Gandhipuram)', onClick: () => pickup.choose(SAMPLE_PICKUP) }
                    : { label: 'Use current location', onClick: () => void useCurrentLocation(), busy: locating }
                }
                extra={
                  locateError ? (
                    <p role="alert" className="text-sm font-semibold text-danger">
                      {locateError} You can still search, click the map or enter coordinates.
                    </p>
                  ) : null
                }
              />
              <LocationField
                label="Destination"
                area={area}
                state={destination}
                picking={picking === 'destination'}
                onTogglePick={() => setPicking((p) => (p === 'destination' ? null : 'destination'))}
              />

              {tooClose && (
                <p role="alert" className="font-semibold text-danger">
                  Pickup and destination must be at least {MIN_SEPARATION_M} metres apart. Choose different places.
                </p>
              )}

              <fieldset>
                <legend className="mb-2 block text-base font-semibold text-ink">Ride type</legend>
                <div className="space-y-2">
                  {TYPES.map((t, i) => {
                    const q = routes[i]
                    const active = type === t.id
                    return (
                      <label
                        key={t.id}
                        className={cn(
                          'bw flex cursor-pointer items-center gap-4 rounded-xl p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
                          active ? 'border-primary bg-primary-soft' : 'border-line-strong bg-surface hover:bg-surface-muted',
                        )}
                      >
                        <input type="radio" name={typeName} value={t.id} checked={active} onChange={() => setType(t.id)} className="sr-only" />
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface text-primary">
                          <t.icon className="h-6 w-6" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-lg font-bold text-ink">{t.label}</span>
                          <span className="block text-sm text-muted">{t.blurb}</span>
                        </span>
                        <span className="text-right text-sm">
                          {!ready ? (
                            <span className="text-muted">Choose both places</span>
                          ) : q.isPending || q.isFetching ? (
                            <Spinner size="sm" label={`Finding ${t.label} route`} />
                          ) : q.data ? (
                            <>
                              <span className="block font-bold text-ink">{formatDistance(q.data.distance_m)}</span>
                              <span className="block text-muted">about {formatDuration(q.data.duration_s)}</span>
                            </>
                          ) : (
                            <span className="block max-w-[10rem] text-danger">{routeFailure(q.error)}</span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <p className="mt-2 text-sm text-muted">
                  Times are estimated travel times for the trip, not when a driver would arrive.{' '}
                  {type === 'walk'
                    ? 'Walking has no fare.'
                    : 'Fare is calculated when you confirm — estimate using demo rates.'}
                </p>
              </fieldset>

              <div className="bw space-y-2 rounded-xl border-line bg-surface-muted p-4">
                <h3 className="text-base font-bold text-ink">Booking summary</h3>
                <dl className="space-y-1 text-base">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Pickup</dt>
                    <dd className="text-right font-semibold text-ink">{from?.label ?? 'Not chosen'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Destination</dt>
                    <dd className="text-right font-semibold text-ink">{to?.label ?? 'Not chosen'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Ride type</dt>
                    <dd className="font-semibold text-ink">{TYPES.find((t) => t.id === type)?.label}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Distance</dt>
                    <dd className="font-semibold text-ink">{selectedRoute ? formatDistance(selectedRoute.distance_m) : '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Estimated time</dt>
                    <dd className="font-semibold text-ink">{selectedRoute ? formatDuration(selectedRoute.duration_s) : '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Fare</dt>
                    <dd className="text-right font-semibold text-ink">
                      {type === 'walk' ? 'No fare for walking' : 'Calculated when you confirm (demo rates)'}
                    </dd>
                  </div>
                </dl>
                <Badge tone="warning">Demo request: no driver, no real booking</Badge>
              </div>

              {submitError && <ErrorBanner message={submitError} />}

              <Button fullWidth onClick={() => void confirm()} loading={create.isPending} disabled={!selectedRoute}>
                Confirm ride request
              </Button>
              {!selectedRoute && (
                <p className="text-sm text-muted">Choose a pickup, a destination and a ride type with a route to continue.</p>
              )}
            </Card>
          )}
        </div>
      </div>

      <RideHistory />
    </div>
  )
}
