import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGeolocation } from '../../hooks/useGeolocation'
import { useSpeech } from '../../hooks/useSpeech'
import { postEvent, type ClientEventSource } from '../../lib/events'
import { haversineM, inServiceArea, type LatLon } from '../../lib/geo'
import { useMode } from '../../lib/mode'
import { fetchRoute, navErrorMessage, useServiceArea, type Place, type RouteMode, type RouteResult } from '../maps/api'
import { geoJsonToLatLng } from '../maps/polyline'
import { usePlace } from '../maps/usePlace'
import { navigationController, useNavigationController } from './controller'
import {
  ARRIVED_DISTANCE_M,
  buildPath,
  currentStepIndex,
  distanceRemaining,
  dueStep,
  INITIAL_OFF_ROUTE,
  OFF_ROUTE_M,
  pointAtDistance,
  snapNear,
  stepPositions,
  trackOffRoute,
  type OffRouteState,
} from './geometry'

export const SIM_TICK_MS = 1000
/** The simulated walker advances this far per tick (a brisk 30 m/s so a test trip does not take an hour). */
export const SIM_STEP_M = 30
/** A new route is only requested automatically when the start has moved this far from the last planned start. */
const REPLAN_MOVE_M = 50

/** A sample start for Simulation mode, where real GPS is never used. */
export const SIMULATED_START: Place = { lat: 11.0183, lon: 76.9725, label: 'Gandhipuram, Coimbatore (simulated start)' }

export interface RouteState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  route: RouteResult | null
  error: string | null
  plannedAt: number | null
}

export interface Progress {
  alongM: number
  remainingM: number
  stepIndex: number
  offRouteM: number
  at: number
}

interface Session {
  started: boolean
  startedAt: number
  announced: Set<number>
  offRoute: OffRouteState
  lastSegment: number
  rerouting: boolean
  arrived: boolean
  coveredM: number
  plannedM: number
  simulated: boolean
}

const newSession = (): Session => ({
  started: false,
  startedAt: 0,
  announced: new Set(),
  offRoute: INITIAL_OFF_ROUTE,
  lastSegment: 0,
  rerouting: false,
  arrived: false,
  coveredM: 0,
  plannedM: 0,
  simulated: false,
})

/**
 * Everything the Navigation page does apart from drawing: GPS (Live) or simulated position (Simulation), route
 * planning, progress along the route, voice guidance, rerouting, arrival and event logging.
 */
export function useNavigation() {
  const { mode: appMode } = useMode()
  const simulation = appMode === 'simulation'
  const source: ClientEventSource = simulation ? 'simulation' : 'live'
  const area = useServiceArea()
  const ctrl = useNavigationController()
  const { destination, mode: routeMode, navigating } = ctrl.state
  const geo = useGeolocation(!simulation, area.bounds)
  const { speak, cancel, voiceEnabled } = useSpeech()

  const start = usePlace(area)
  const dest = usePlace(area, {
    value: destination,
    set: (p) => {
      ctrl.setDestination(p)
    },
  })

  const [simulating, setSimulating] = useState(false)
  const [simPos, setSimPos] = useState<LatLon | null>(null)
  const [routeState, setRouteState] = useState<RouteState>({ status: 'idle', route: null, error: null, plannedAt: null })
  const [progress, setProgress] = useState<Progress | null>(null)
  const [guidance, setGuidance] = useState<{ text: string; n: number } | null>(null)
  const [arrived, setArrived] = useState(false)

  /* ---------- where the person is ---------- */
  const gpsUsable = !simulation && geo.status !== 'idle' && !!geo.position && geo.inArea === true
  const gpsLost = navigating && !simulation && (geo.status === 'timeout' || geo.status === 'unavailable' || geo.status === 'denied')
  const navPos: LatLon | null = simulation ? (simulating ? simPos : null) : gpsUsable && geo.position ? geo.position : null
  const origin: LatLon | null = start.place ?? (gpsUsable && geo.position ? geo.position : null)

  // The best-known position, for "Where am I?" and the voice assistant.
  useEffect(() => {
    const p = navPos ?? origin
    navigationController.publishPosition(p ? { lat: p.lat, lon: p.lon, simulated: simulation } : null)
  }, [navPos, origin, simulation])
  useEffect(() => () => navigationController.publishPosition(null), [])

  /* ---------- the route ---------- */
  const route = routeState.route
  const latLngs = useMemo(() => (route ? geoJsonToLatLng(route.geometry.coordinates) : []), [route])
  const path = useMemo(() => buildPath(latLngs), [latLngs])
  const positions = useMemo(() => (route ? stepPositions(path, route.steps) : []), [route, path])

  const latest = useRef({ path, positions, route, destination, routeMode, source, simulation })
  useEffect(() => {
    latest.current = { path, positions, route, destination, routeMode, source, simulation }
  })
  const session = useRef<Session>(newSession())
  const planAbort = useRef<AbortController | null>(null)
  const lastPlan = useRef<{ key: string; from: LatLon } | null>(null)

  const say = useCallback(
    (text: string) => {
      speak(text, { interrupt: true })
      setGuidance((g) => ({ text, n: (g?.n ?? 0) + 1 }))
    },
    [speak],
  )

  const plan = useCallback(
    async (from: LatLon, to: LatLon, m: RouteMode, keepRoute: boolean): Promise<RouteResult | null> => {
      planAbort.current?.abort()
      const controller = new AbortController()
      planAbort.current = controller
      setRouteState((s) => ({ status: 'loading', route: keepRoute ? s.route : null, error: null, plannedAt: s.plannedAt }))
      try {
        const res = await fetchRoute(from, to, m, controller.signal, area)
        if (controller.signal.aborted) return null
        setRouteState({ status: 'ready', route: res, error: null, plannedAt: Date.now() })
        return res
      } catch (err) {
        if (controller.signal.aborted) return null
        setRouteState((s) => ({ status: 'error', route: keepRoute ? s.route : null, error: navErrorMessage(err), plannedAt: s.plannedAt }))
        return null
      }
    },
    [area],
  )

  // Plan (and re-plan) while not navigating: when the start, destination or travel mode changes.
  useEffect(() => {
    if (navigating) return
    if (!origin || !destination) {
      planAbort.current?.abort()
      lastPlan.current = null
      setRouteState((s) => (s.status === 'idle' ? s : { status: 'idle', route: null, error: null, plannedAt: null }))
      return
    }
    const key = `${destination.lat},${destination.lon}|${routeMode}`
    const prev = lastPlan.current
    if (prev && prev.key === key && haversineM(prev.from, origin) < REPLAN_MOVE_M) return
    lastPlan.current = { key, from: { lat: origin.lat, lon: origin.lon } }
    void plan(origin, destination, routeMode, false)
  }, [origin, destination, routeMode, navigating, plan])

  // Changing mode or destination while navigating re-plans from where the person is now.
  const tripKey = useRef('')
  useEffect(() => {
    const key = destination ? `${destination.lat},${destination.lon}|${routeMode}` : ''
    const prev = tripKey.current
    tripKey.current = key
    if (!navigating || !session.current.started || prev === key || !destination) return
    const from = navPos ?? origin
    if (!from) return
    void plan(from, destination, routeMode, true).then((res) => {
      if (res && session.current.started) {
        session.current.announced = new Set([0])
        session.current.lastSegment = 0
        session.current.plannedM = res.distance_m
        if (res.steps[0]) say(res.steps[0].instruction)
      }
    })
    // only the trip key (destination or mode) should trigger this
  }, [destination, routeMode])

  /* ---------- trip lifecycle ---------- */
  const endSession = useCallback(
    (arrivedAtEnd: boolean) => {
      const s = session.current
      if (!s.started) return
      s.started = false
      const { destination: d, routeMode: m, source: src } = latest.current
      const elapsed = Math.max(0, Math.round((Date.now() - s.startedAt) / 1000))
      void postEvent({
        type: 'navigation',
        source: src,
        title: `Navigation ${arrivedAtEnd ? 'completed' : 'stopped'}${d ? `: ${d.label}` : ''}`.slice(0, 200),
        status: arrivedAtEnd ? 'completed' : 'stopped',
        details: {
          destination: d ? { label: d.label, lat: d.lat, lon: d.lon } : null,
          mode: m,
          distance_m: Math.round(s.coveredM),
          duration_s: elapsed,
          planned_distance_m: Math.round(s.plannedM),
          arrived: arrivedAtEnd,
          simulated_path: s.simulated,
        },
      })
    },
    [],
  )

  // Intent -> active trip, once a route exists.
  useEffect(() => {
    if (!navigating) {
      if (session.current.started) {
        const arrivedNow = session.current.arrived
        endSession(arrivedNow)
        cancel()
        setSimulating(false)
        setSimPos(null)
        setProgress(null)
        session.current = newSession()
      }
      return
    }
    if (session.current.started || routeState.status !== 'ready' || !route || !destination) return
    const s = newSession()
    s.started = true
    s.startedAt = Date.now()
    s.announced = new Set([0])
    s.plannedM = route.distance_m
    session.current = s
    setArrived(false)
    setProgress(null)
    const first = route.steps[0]?.instruction
    say(first ?? 'Navigation started.')
    void postEvent({
      type: 'navigation',
      source,
      title: `Navigation started to ${destination.label}`.slice(0, 200),
      status: 'started',
      details: {
        destination: { label: destination.label, lat: destination.lat, lon: destination.lon },
        mode: routeMode,
        distance_m: Math.round(route.distance_m),
        duration_s: Math.round(route.duration_s),
        provider: route.provider,
      },
    })
  }, [navigating, routeState.status, route, destination, routeMode, source, say, cancel, endSession])

  // Leaving the page ends the trip: GPS and speech only run here.
  useEffect(
    () => () => {
      if (session.current.started) endSession(false)
      cancel()
      planAbort.current?.abort()
      navigationController.stop()
    },
    [endSession, cancel],
  )

  /* ---------- every new position while navigating ---------- */
  useEffect(() => {
    const s = session.current
    if (!navigating || !s.started || !navPos) return
    const { path: p, positions: pos, route: r, destination: d, routeMode: m } = latest.current
    if (!r || !d || p.points.length < 2) return
    const snap = snapNear(p, navPos, s.lastSegment)
    if (!snap) return
    s.lastSegment = snap.segment
    s.coveredM = Math.max(s.coveredM, Math.min(snap.alongM, p.totalM))
    s.simulated = s.simulated || simulating
    const remaining = distanceRemaining(p, snap.alongM)
    setProgress({ alongM: snap.alongM, remainingM: remaining, stepIndex: currentStepIndex(pos, snap.alongM), offRouteM: snap.distanceM, at: Date.now() })

    if (remaining <= ARRIVED_DISTANCE_M && snap.distanceM <= OFF_ROUTE_M) {
      s.arrived = true
      say('You have arrived.')
      setArrived(true)
      navigationController.stop()
      return
    }

    const tracked = trackOffRoute(s.offRoute, snap.distanceM, Date.now())
    s.offRoute = tracked.state
    if (tracked.reroute && !s.rerouting) {
      s.rerouting = true
      say('Rerouting.')
      const from = { lat: navPos.lat, lon: navPos.lon }
      void plan(from, d, m, true).then((res) => {
        s.rerouting = false
        if (res && session.current === s) {
          s.announced = new Set([0])
          s.lastSegment = 0
          s.offRoute = { count: 0, lastRerouteAt: s.offRoute.lastRerouteAt }
          s.plannedM = s.coveredM + res.distance_m
          if (res.steps[0]) say(res.steps[0].instruction)
        }
      })
      return
    }
    if (snap.distanceM <= OFF_ROUTE_M) {
      const due = dueStep(pos, snap.alongM, s.announced)
      if (due !== null) {
        s.announced.add(due)
        say(r.steps[due].instruction)
      }
    }
    // each new position is handled exactly once; everything else is read from `latest`
  }, [navPos])

  // GPS loss while navigating is said out loud once, then recovery is simply the next fix.
  const wasLost = useRef(false)
  useEffect(() => {
    if (gpsLost && !wasLost.current) say('GPS signal lost.')
    wasLost.current = gpsLost
  }, [gpsLost, say])

  /* ---------- simulated walk (Simulation mode only) ---------- */
  const simAlong = useRef(0)
  useEffect(() => {
    if (!simulating || !simulation || !navigating || path.points.length < 2) return
    const tick = () => {
      simAlong.current = Math.min(path.totalM, simAlong.current + SIM_STEP_M)
      setSimPos(pointAtDistance(path, simAlong.current))
    }
    tick()
    const id = window.setInterval(tick, SIM_TICK_MS)
    return () => window.clearInterval(id)
  }, [simulating, simulation, navigating, path])

  const toggleSimulation = useCallback(() => {
    if (!simulation) return
    setSimulating((on) => {
      if (!on) simAlong.current = Math.max(0, session.current.coveredM)
      return !on
    })
  }, [simulation])

  /* ---------- controls ---------- */
  const startNavigation = useCallback(() => ctrl.start(), [ctrl])
  const stopNavigation = useCallback(() => ctrl.stop(), [ctrl])

  // Reaching a place not in the service area by any route is refused client-side already; this guards stale state.
  const originInArea = !origin || inServiceArea(origin.lat, origin.lon, area.bounds)

  return {
    simulation,
    area,
    geo,
    gpsUsable,
    gpsLost,
    navPos,
    origin,
    originInArea,
    start,
    dest,
    destination,
    routeMode,
    setMode: ctrl.setMode,
    navigating,
    routeState,
    route,
    latLngs,
    progress,
    guidance,
    arrived,
    simulating,
    simPos,
    toggleSimulation,
    startNavigation,
    stopNavigation,
    voiceEnabled,
    useSimulatedStart: () => start.choose(SIMULATED_START),
  }
}
