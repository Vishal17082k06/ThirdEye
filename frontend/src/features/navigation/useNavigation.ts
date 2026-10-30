import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGeolocation } from '../../hooks/useGeolocation'
import { useSpeech } from '../../hooks/useSpeech'
import { postEvent, type ClientEventSource } from '../../lib/events'
import { haversineM, type LatLon } from '../../lib/geo'
import { useMode } from '../../lib/mode'
import { fetchRoute, navErrorMessage, useServiceArea, type Place, type RouteMode, type RouteResult } from '../maps/api'
import { geoJsonToLatLng } from '../maps/polyline'
import { usePlace } from '../maps/usePlace'
import { navigationController, useNavigationController } from './controller'
import {
  announceDistanceFor,
  ARRIVED_DISTANCE_M,
  buildPath,
  currentStepIndex,
  distanceRemaining,
  dueStep,
  INITIAL_OFF_ROUTE,
  MAX_USABLE_ACCURACY_M,
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
/** No GPS fix for this long while navigating means the signal is lost. */
export const navTiming = {
  /** no GPS fix for this long while navigating means the signal is lost */
  staleMs: 20_000,
  checkMs: 5_000,
  /** "signal lost" is only spoken if the person was moving in this window */
  movedRecentMs: 30_000,
}
const MOVED_THRESHOLD_M = 15

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
  /** furthest point reached along the current route; progress never goes backwards because of GPS jitter */
  maxAlong: number
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
  maxAlong: 0,
  rerouting: false,
  arrived: false,
  coveredM: 0,
  plannedM: 0,
  simulated: false,
})

type Pos = LatLon & { accuracy?: number | null }

/**
 * The trip engine behind NavigationProvider: GPS (Live) or simulated position (Simulation), route planning, progress
 * along the route, voice guidance, rerouting, arrival, GPS-loss detection and event logging. It lives above the
 * router, so a trip keeps running when the person visits other pages.
 */
export function useNavigationEngine() {
  const { mode: appMode } = useMode()
  const simulation = appMode === 'simulation'
  const source: ClientEventSource = simulation ? 'simulation' : 'live'
  const area = useServiceArea()
  const ctrl = useNavigationController()
  const { destination, mode: routeMode, navigating } = ctrl.state

  // GPS is watched only while the Navigation page is open or a trip is running.
  const [pageCount, setPageCount] = useState(0)
  const registerPage = useCallback(() => {
    setPageCount((n) => n + 1)
    return () => setPageCount((n) => Math.max(0, n - 1))
  }, [])
  const geo = useGeolocation(!simulation && (pageCount > 0 || navigating), area.bounds)
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
  const [tripActive, setTripActive] = useState(false)
  const [stale, setStale] = useState(false)

  /* ---------- where the person is ---------- */
  const gpsUsable = !simulation && geo.status !== 'idle' && !!geo.position && geo.inArea === true
  const hardLost = navigating && !simulation && (geo.status === 'unavailable' || geo.status === 'denied')
  const gpsLost = navigating && !simulation && (stale || hardLost)
  const navPos: Pos | null = simulation ? (simulating ? simPos : null) : gpsUsable && geo.position ? geo.position : null
  const origin: LatLon | null = start.place ?? (gpsUsable && geo.position ? geo.position : null)
  const lowAccuracy = navigating && (navPos?.accuracy ?? 0) > MAX_USABLE_ACCURACY_M

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

  /** Shows the text and speaks it. `interrupt: false` queues behind (or is dropped in favour of) current speech. */
  const say = useCallback(
    (text: string, interrupt = true) => {
      speak(text, { interrupt })
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

  // Plan (and re-plan) until a trip is under way: when the start, destination or travel mode changes.
  useEffect(() => {
    if (session.current.started) return
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
  }, [origin, destination, routeMode, navigating, tripActive, plan])

  // Changing mode or destination during a trip re-plans from where the person is now.
  const tripKey = useRef('')
  useEffect(() => {
    const key = destination ? `${destination.lat},${destination.lon}|${routeMode}` : ''
    const prev = tripKey.current
    tripKey.current = key
    if (!navigating || !session.current.started || prev === key || !destination) return
    const from = navPos ?? origin
    if (!from) return
    const s = session.current
    void plan(from, destination, routeMode, true).then((res) => {
      if (res && session.current === s && s.started) {
        s.announced = new Set([0])
        s.lastSegment = 0
        s.maxAlong = 0
        s.plannedM = res.distance_m
        if (res.steps[0]) say(res.steps[0].instruction)
      }
    })
    // only the trip key (destination or mode) should trigger this
  }, [destination, routeMode])

  /* ---------- trip lifecycle ---------- */
  /** Ends the trip: logs the stop, and stops speech unless the trip ended by arrival (let "You have arrived." finish). */
  const finishTrip = useCallback(
    (arrivedAtEnd: boolean, srcOverride?: ClientEventSource) => {
      const s = session.current
      if (!s.started) return
      s.started = false
      const { destination: d, routeMode: m, source: src } = latest.current
      const elapsed = Math.max(0, Math.round((Date.now() - s.startedAt) / 1000))
      void postEvent({
        type: 'navigation',
        source: srcOverride ?? src,
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
      if (!arrivedAtEnd) cancel()
      setSimulating(false)
      setSimPos(null)
      setProgress(null)
      setStale(false)
      setTripActive(false)
      session.current = newSession()
    },
    [cancel],
  )

  // Intent -> active trip, once a route exists.
  useEffect(() => {
    if (!navigating) {
      if (session.current.started) finishTrip(session.current.arrived)
      return
    }
    if (session.current.started || routeState.status !== 'ready' || !route || !destination) return
    const s = newSession()
    s.started = true
    s.startedAt = Date.now()
    s.announced = new Set([0])
    s.plannedM = route.distance_m
    session.current = s
    lastFix.current = { at: Date.now(), anchor: null, movedAt: 0, spoken: false }
    setArrived(false)
    setProgress(null)
    setTripActive(true)
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
  }, [navigating, routeState.status, route, destination, routeMode, source, say, finishTrip])

  // Switching between Live and Simulation ends a running trip (and logs it under the mode it ran in).
  const prevSimulation = useRef(simulation)
  useEffect(() => {
    if (prevSimulation.current === simulation) return
    const ranIn: ClientEventSource = prevSimulation.current ? 'simulation' : 'live'
    prevSimulation.current = simulation
    navigationController.stop()
    finishTrip(false, ranIn)
    start.clear()
  }, [simulation, finishTrip, start])

  // The provider going away (logout, app closing) ends the trip too.
  useEffect(
    () => () => {
      finishTrip(false)
      cancel()
      planAbort.current?.abort()
      navigationController.stop()
    },
    [finishTrip, cancel],
  )

  /* ---------- GPS fixes: staleness ---------- */
  const lastFix = useRef<{ at: number; anchor: LatLon | null; movedAt: number; spoken: boolean }>({ at: 0, anchor: null, movedAt: 0, spoken: false })
  const fix = simulation ? null : geo.position
  useEffect(() => {
    if (!fix) return
    const f = lastFix.current
    const now = Date.now()
    f.at = now
    f.spoken = false
    if (!f.anchor || haversineM(f.anchor, fix) > MOVED_THRESHOLD_M) {
      f.anchor = { lat: fix.lat, lon: fix.lon }
      f.movedAt = now
    }
    setStale(false)
  }, [fix])

  useEffect(() => {
    if (!navigating || simulation) return
    const id = window.setInterval(() => {
      const f = lastFix.current
      const now = Date.now()
      if (!session.current.started || now - f.at <= navTiming.staleMs) return
      setStale(true)
      if (!f.spoken) {
        f.spoken = true
        // Standing still with a quiet GPS is not worth interrupting anyone for.
        if (now - f.movedAt < navTiming.movedRecentMs) say('GPS signal lost.')
      }
    }, navTiming.checkMs)
    return () => window.clearInterval(id)
  }, [navigating, simulation, say])

  // A refused permission or an unavailable device during a trip is said once.
  const wasHardLost = useRef(false)
  useEffect(() => {
    if (hardLost && !wasHardLost.current) say('GPS signal lost.')
    wasHardLost.current = hardLost
  }, [hardLost, say])

  /* ---------- every new position while navigating ---------- */
  useEffect(() => {
    const s = session.current
    if (!navigating || !s.started || !navPos) return
    // A fix this imprecise is drawn on the map but never used for decisions.
    if ((navPos.accuracy ?? 0) > MAX_USABLE_ACCURACY_M) return
    const { path: p, positions: pos, route: r, destination: d, routeMode: m } = latest.current
    if (!r || !d || p.points.length < 2) return
    const snap = snapNear(p, navPos, s.lastSegment)
    if (!snap) return
    s.lastSegment = snap.segment
    const along = Math.max(s.maxAlong, snap.alongM)
    s.maxAlong = along
    s.coveredM = Math.max(s.coveredM, Math.min(along, p.totalM))
    s.simulated = s.simulated || latest.current.simulation
    const remaining = distanceRemaining(p, along)
    setProgress({ alongM: along, remainingM: remaining, stepIndex: currentStepIndex(pos, along), offRouteM: snap.distanceM, at: Date.now() })

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
          s.maxAlong = 0
          s.offRoute = { count: 0, lastRerouteAt: s.offRoute.lastRerouteAt }
          s.plannedM = s.coveredM + res.distance_m
          // Do not cut "Rerouting." short: this one waits its turn (or is dropped), it never interrupts.
          if (res.steps[0]) say(res.steps[0].instruction, false)
        }
      })
      return
    }
    if (snap.distanceM <= OFF_ROUTE_M) {
      const due = dueStep(pos, along, s.announced, announceDistanceFor(m))
      if (due !== null) {
        s.announced.add(due)
        say(r.steps[due].instruction)
      }
    }
    // each new position is handled exactly once; everything else is read from `latest`
  }, [navPos])

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

  const startNavigation = useCallback(() => ctrl.start(), [ctrl])
  const stopNavigation = useCallback(() => ctrl.stop(), [ctrl])

  return {
    simulation,
    area,
    geo,
    gpsUsable,
    gpsLost,
    lowAccuracy,
    navPos,
    origin,
    start,
    dest,
    destination,
    routeMode,
    setMode: ctrl.setMode,
    navigating,
    tripActive,
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
    registerPage,
    chooseSimulatedStart: () => start.choose(SIMULATED_START),
  }
}

export type NavigationEngine = ReturnType<typeof useNavigationEngine>
