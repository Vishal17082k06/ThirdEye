import {
  Bike,
  Car,
  CheckCircle2,
  CircleAlert,
  FlaskConical,
  Footprints,
  LocateFixed,
  MapPin,
  Navigation as NavigationIcon,
  Play,
  RefreshCw,
  Route as RouteIcon,
  Square,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { Badge, Button, Card, CardHeader, Spinner } from '../../design'
import { cn } from '../../lib/cn'
import { arrivalClock, formatDistance, formatDuration } from '../../lib/geo'
import { ErrorBanner } from '../auth/FormBanner'
import type { RouteMode, RouteResult } from '../maps/api'
import { LocationField } from '../maps/LocationField'
import { MapView, type MapMarker } from '../maps/MapView'
import { useNavigationState } from './navigationContext'
import { SIM_STEP_M, SIM_TICK_MS, type Progress } from './useNavigation'
import { useWhereAmI } from './useWhereAmI'

const MODES: Array<{ id: RouteMode; label: string; verb: string; icon: LucideIcon }> = [
  { id: 'foot', label: 'Walking', verb: 'walking', icon: Footprints },
  { id: 'car', label: 'Car', verb: 'by car', icon: Car },
  { id: 'bike', label: 'Bicycle', verb: 'by bicycle', icon: Bike },
]

type Picking = 'start' | 'destination' | null

function ModeToggle({ value, onChange }: { value: RouteMode; onChange: (m: RouteMode) => void }) {
  const name = useId()
  return (
    <fieldset>
      <legend className="mb-1.5 block text-base font-semibold text-ink">Travel mode</legend>
      <div className="grid grid-cols-3 gap-2">
        {MODES.map(({ id, label, icon: Icon }) => (
          <label
            key={id}
            className={cn(
              'bw flex min-h-[var(--control-h)] cursor-pointer items-center justify-center gap-2 rounded-xl px-2 py-2 text-base font-semibold transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
              value === id ? 'border-primary bg-primary-soft text-primary' : 'border-line-strong bg-surface text-ink hover:bg-surface-muted',
            )}
          >
            <input type="radio" name={name} value={id} checked={value === id} onChange={() => onChange(id)} className="sr-only" />
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-xl font-extrabold text-ink">{value}</dd>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  )
}

function RouteSummary({ route, verb, plannedAt, progress, navigating }: { route: RouteResult; verb: string; plannedAt: number | null; progress: Progress | null; navigating: boolean }) {
  const remaining = navigating && progress ? progress.remainingM : route.distance_m
  const fraction = route.distance_m > 0 ? Math.min(1, remaining / route.distance_m) : 1
  const seconds = route.duration_s * fraction
  const base = navigating && progress ? new Date(progress.at) : new Date(plannedAt ?? 0)
  return (
    <div className="bw rounded-xl border-line bg-surface-muted p-4">
      <p className="mb-2 text-sm font-semibold text-muted">{navigating ? 'Remaining' : `Route ${verb}`}</p>
      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Distance" value={formatDistance(remaining)} />
        <Stat label="Time" value={formatDuration(seconds)} note="estimated" />
        <Stat label="Arrive about" value={plannedAt || progress ? arrivalClock(seconds, base) : '—'} note="estimated" />
      </dl>
      <p className="mt-3 text-xs text-muted">
        Times come from the routing provider ({route.provider}) and are estimates, not guarantees. Route data: OpenStreetMap contributors.
      </p>
    </div>
  )
}

export function NavigationPage() {
  const nav = useNavigationState()
  const { registerPage } = nav
  useEffect(() => registerPage(), [registerPage])
  const whereAmI = useWhereAmI()
  const [picking, setPicking] = useState<Picking>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [where, setWhere] = useState<{ text: string; busy: boolean }>({ text: '', busy: false })
  const { simulation, geo, area, start, dest, routeState, route, navigating, progress } = nav
  const modeInfo = MODES.find((m) => m.id === nav.routeMode) ?? MODES[0]
  const showManualStart = simulation || !nav.gpsUsable || manualOpen || !!start.place

  const markers: MapMarker[] = []
  if (start.place) markers.push({ lat: start.place.lat, lon: start.place.lon, label: `Starting point: ${start.place.label}`, kind: 'start' })
  if (nav.destination) markers.push({ lat: nav.destination.lat, lon: nav.destination.lon, label: `Destination: ${nav.destination.label}`, kind: 'destination' })

  // The "you are here" dot: the real fix in Live mode (even outside the area, so the person sees where they are), the simulated walker otherwise.
  const current = simulation
    ? nav.simPos && nav.simulating
      ? { lat: nav.simPos.lat, lon: nav.simPos.lon, accuracy: null, label: 'Simulated position' }
      : null
    : geo.position
      ? { lat: geo.position.lat, lon: geo.position.lon, accuracy: geo.accuracy, label: 'Your current location' }
      : null

  function onMapSelect(lat: number, lon: number) {
    if (picking === 'start') void start.pin(lat, lon)
    else if (picking === 'destination') void dest.pin(lat, lon)
    setPicking(null)
  }

  const selectingText = picking === 'start' ? 'Click the map to set your starting point' : picking === 'destination' ? 'Click the map to set your destination' : null

  const status = useMemo(() => {
    const parts: string[] = []
    if (nav.navigating) parts.push('Navigating')
    parts.push(
      start.place
        ? `Starting point: ${start.place.label}.`
        : nav.gpsUsable
          ? 'Starting from your GPS location.'
          : 'No starting point chosen yet.',
    )
    parts.push(nav.destination ? `Destination: ${nav.destination.label}.` : 'No destination chosen yet.')
    if (routeState.status === 'loading') parts.push('Finding a route.')
    if (route) parts.push(`Route ${modeInfo.verb}: ${formatDistance(route.distance_m)}, about ${formatDuration(route.duration_s)} (estimated).`)
    return parts.join(' ')
  }, [nav.navigating, nav.gpsUsable, nav.destination, start.place, routeState.status, route, modeInfo.verb])

  async function askWhere() {
    setWhere({ text: '', busy: true })
    const text = await whereAmI.ask()
    setWhere({ text, busy: false })
  }

  const currentStep = navigating && progress ? progress.stepIndex : navigating ? 0 : -1
  const canStart = routeState.status === 'ready' && !!route && !navigating
  const waitingForPosition = navigating && !nav.navPos && !nav.gpsLost

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Navigation</h1>
        <p className="mt-1 text-base text-muted">Walking, car and bicycle routes inside Coimbatore, with spoken turn-by-turn directions.</p>
      </div>

      {simulation && (
        <div role="note" className="bw flex items-start gap-3 rounded-xl border-sim bg-sim-soft p-4 text-sim">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="font-semibold">
            SIMULATION MODE. Real GPS is not used here. Pick a starting point yourself, then use the simulated walk to test the
            navigation interface. Every position shown while it runs is SIMULATED.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-4">
          <MapView
            area={area}
            current={current}
            markers={markers}
            route={nav.latLngs}
            onSelect={picking ? onMapSelect : undefined}
            selecting={selectingText}
            follow={navigating}
            className="h-[22rem] sm:h-[30rem] lg:h-[36rem]"
            ariaLabel="Map of Coimbatore showing your route"
          />
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {status}
          </p>

          {navigating && (
            <Card as="section" aria-label="Guidance" className="border-primary bg-primary-soft">
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">
                {nav.simulating ? 'Simulated guidance' : 'Guidance'}
              </p>
              <p aria-live="polite" className="mt-1 text-xl font-bold text-ink">
                {nav.guidance?.text ?? 'Starting navigation'}
              </p>
              {!nav.voiceEnabled && (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                  <Volume2 className="h-4 w-4" aria-hidden="true" /> Spoken guidance is off in Settings. Instructions appear here instead.
                </p>
              )}
            </Card>
          )}

          {nav.arrived && !navigating && (
            <div role="status" className="bw flex items-start gap-3 rounded-xl border-success bg-success-soft p-4 text-success">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="font-semibold">You have arrived{nav.destination ? ` at ${nav.destination.label}` : ''}.</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card as="section" aria-labelledby="loc-h">
            <CardHeader
              id="loc-h"
              title="Your location"
              icon={<LocateFixed className="h-5 w-5" aria-hidden="true" />}
              action={
                simulation ? (
                  <Badge tone="simulation" className="uppercase tracking-wide">
                    Simulated
                  </Badge>
                ) : geo.status === 'active' && nav.gpsUsable ? (
                  <Badge tone="live">GPS live</Badge>
                ) : undefined
              }
            />
            {simulation ? (
              <p className="text-base text-muted">Simulation mode does not use your device&apos;s GPS. Choose where the trip starts below.</p>
            ) : geo.status === 'requesting' || geo.status === 'idle' ? (
              <p className="flex items-center gap-2 text-base text-muted">
                <Spinner size="sm" label="Finding your location" /> Finding your location…
              </p>
            ) : nav.gpsUsable && geo.position ? (
              <div className="space-y-1">
                <p className="text-base font-semibold text-ink">
                  {geo.position.lat.toFixed(5)}, {geo.position.lon.toFixed(5)}
                </p>
                <p className="text-sm text-muted">
                  {geo.accuracy != null ? `Accuracy about ${Math.round(geo.accuracy)} m.` : 'Accuracy not reported.'} You are inside the Coimbatore service area.
                </p>
              </div>
            ) : geo.position && geo.inArea === false ? (
              <p role="alert" className="font-semibold text-warning">
                Your GPS position is outside the Coimbatore service area. {area.message} Choose a starting point inside Coimbatore below.
              </p>
            ) : (
              <p role="alert" className="font-semibold text-danger">
                {geo.message ?? 'GPS not available.'}
              </p>
            )}
            {!simulation && !nav.gpsUsable && geo.status !== 'requesting' && geo.status !== 'idle' && (
              <div className="mt-3">
                <Button variant="secondary" onClick={geo.retry} leftIcon={<RefreshCw className="h-5 w-5" aria-hidden="true" />}>
                  Try GPS again
                </Button>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => void askWhere()} loading={where.busy} leftIcon={<MapPin className="h-5 w-5" aria-hidden="true" />}>
                Where am I?
              </Button>
              {!simulation && nav.gpsUsable && !showManualStart && (
                <Button variant="ghost" onClick={() => setManualOpen(true)}>
                  Start from somewhere else
                </Button>
              )}
            </div>
            <p role="status" aria-live="polite" className={cn('mt-2 text-base text-ink', !where.text && 'sr-only')}>
              {where.text}
            </p>
          </Card>

          <Card as="section" aria-labelledby="plan-h" className="space-y-4">
            <CardHeader id="plan-h" title="Plan your route" icon={<RouteIcon className="h-5 w-5" aria-hidden="true" />} />
            {showManualStart && (
              <LocationField
                label="Starting point"
                area={area}
                state={start}
                picking={picking === 'start'}
                onTogglePick={() => setPicking((p) => (p === 'start' ? null : 'start'))}
                useCurrent={
                  simulation
                    ? { label: 'Use sample start (Gandhipuram)', onClick: nav.chooseSimulatedStart }
                    : nav.gpsUsable
                      ? { label: 'Use my GPS location', onClick: () => { start.clear(); setManualOpen(false) } }
                      : undefined
                }
              />
            )}
            <LocationField
              label="Destination"
              area={area}
              state={dest}
              picking={picking === 'destination'}
              onTogglePick={() => setPicking((p) => (p === 'destination' ? null : 'destination'))}
            />
            <ModeToggle value={nav.routeMode} onChange={nav.setMode} />

            {nav.startFailure && <ErrorBanner message={nav.startFailure} />}
            {routeState.status === 'loading' && (
              <p className="flex items-center gap-2 text-base text-muted">
                <Spinner size="sm" label="Finding a route" /> Finding a route…
              </p>
            )}
            {routeState.status === 'error' && routeState.error && <ErrorBanner message={routeState.error} />}
            {route && <RouteSummary route={route} verb={modeInfo.verb} plannedAt={routeState.plannedAt} progress={progress} navigating={navigating} />}
            {routeState.status === 'idle' && (
              <p className="text-sm text-muted">
                {nav.destination ? 'Choose a starting point to see the route.' : 'Choose a destination to see the route, distance and arrival time.'}
              </p>
            )}

            {nav.gpsLost && (
              <p role="alert" className="font-semibold text-danger">
                GPS signal lost. Navigation is paused until your position comes back.
              </p>
            )}
            {waitingForPosition && (
              <p className="text-sm text-muted">
                {simulation ? 'Waiting for a position. Press "Simulate walking along the route" to move along it.' : 'Waiting for a GPS position to follow the route.'}
              </p>
            )}

            {nav.lowAccuracy && (
              <p role="status" className="text-sm font-semibold text-warning">
                Low GPS accuracy: the latest position is too imprecise to follow, so guidance waits for a better fix.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {!navigating ? (
                <Button onClick={nav.startNavigation} disabled={!canStart} leftIcon={<NavigationIcon className="h-5 w-5" aria-hidden="true" />}>
                  Start navigation
                </Button>
              ) : (
                <Button variant="danger" onClick={nav.stopNavigation} leftIcon={<Square className="h-5 w-5" aria-hidden="true" />}>
                  Stop navigation
                </Button>
              )}
              {simulation && navigating && (
                <Button variant="secondary" onClick={nav.toggleSimulation} aria-pressed={nav.simulating} leftIcon={<Play className="h-5 w-5" aria-hidden="true" />}>
                  {nav.simulating ? 'Pause simulated walk' : 'Simulate walking along the route'}
                </Button>
              )}
            </div>
            {simulation && navigating && nav.simulating && (
              <p className="text-sm font-semibold text-sim">
                SIMULATED position: moves {SIM_STEP_M} m every {SIM_TICK_MS / 1000} s along the route. This is not GPS.
              </p>
            )}
            {navigating && <p className="text-sm text-muted">Navigation keeps running if you open another page. Press Stop navigation to end it.</p>}
          </Card>
        </div>
      </div>

      {route && (
        <Card as="section" aria-labelledby="dir-h">
          <CardHeader id="dir-h" title="Turn-by-turn directions" icon={<CircleAlert className="h-5 w-5" aria-hidden="true" />} />
          <ol className="space-y-2" aria-label="Directions">
            {route.steps.map((s, i) => (
              <li
                key={i}
                aria-current={i === currentStep ? 'step' : undefined}
                className={cn(
                  'bw flex items-start justify-between gap-3 rounded-xl px-4 py-3',
                  i === currentStep ? 'border-primary bg-primary-soft' : 'border-line bg-surface',
                )}
              >
                <span className="text-base font-semibold text-ink">
                  {i + 1}. {s.instruction}
                </span>
                {s.distance_m > 0 && <span className="shrink-0 text-sm text-muted">{formatDistance(s.distance_m)}</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}
