import { haversineM, type LatLon } from '../../lib/geo'
import type { RouteStep } from '../maps/api'
import type { LatLngTuple } from '../maps/polyline'

/** Pure route maths for turn-by-turn guidance. Nothing here touches React, the network or the clock. */

export const ANNOUNCE_DISTANCE_M = 40
/** Faster travel needs earlier warning: walking 40 m, bicycle 60 m, car 120 m before the manoeuvre. */
export function announceDistanceFor(mode: 'foot' | 'bike' | 'car'): number {
  return mode === 'car' ? 120 : mode === 'bike' ? 60 : ANNOUNCE_DISTANCE_M
}
/** A GPS fix less precise than this is drawn but never used to decide anything. */
export const MAX_USABLE_ACCURACY_M = 100
export const ARRIVED_DISTANCE_M = 25
export const OFF_ROUTE_M = 50
export const OFF_ROUTE_FIXES = 3
export const REROUTE_MIN_INTERVAL_MS = 15_000

export interface RoutePath {
  points: LatLon[]
  /** cumulative[i] = metres along the route from the start to points[i] */
  cumulative: number[]
  totalM: number
}

const M_PER_DEG = (6_371_000 * Math.PI) / 180

export function buildPath(latLngs: LatLngTuple[]): RoutePath {
  const points = latLngs.map(([lat, lon]) => ({ lat, lon }))
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + haversineM(points[i - 1], points[i]))
  return { points, cumulative, totalM: cumulative[cumulative.length - 1] ?? 0 }
}

export interface SegmentProjection {
  /** shortest distance from the point to the segment, metres */
  distanceM: number
  /** where the closest point lies on the segment, 0 (start) to 1 (end) */
  t: number
}

/** Distance from p to the segment a-b, on a local flat plane (accurate to well under a metre at city scale). */
export function pointToSegment(p: LatLon, a: LatLon, b: LatLon): SegmentProjection {
  const k = Math.cos((a.lat * Math.PI) / 180)
  const bx = (b.lon - a.lon) * k * M_PER_DEG
  const by = (b.lat - a.lat) * M_PER_DEG
  const px = (p.lon - a.lon) * k * M_PER_DEG
  const py = (p.lat - a.lat) * M_PER_DEG
  const len2 = bx ** 2 + by ** 2
  let t = len2 === 0 ? 0 : (px * bx + py * by) / len2
  t = Math.max(0, Math.min(1, t))
  return { distanceM: Math.hypot(px - t * bx, py - t * by), t }
}

export interface Snap {
  /** how far the point is from the route line, metres */
  distanceM: number
  /** metres travelled along the route to the closest point */
  alongM: number
  segment: number
}

/** Closest point on the route, searching segments fromSeg..toSeg (inclusive). */
export function snapToRoute(path: RoutePath, p: LatLon, fromSeg = 0, toSeg = path.points.length - 2): Snap | null {
  if (path.points.length < 2) return null
  let best: Snap | null = null
  const last = Math.min(toSeg, path.points.length - 2)
  for (let i = Math.max(0, fromSeg); i <= last; i++) {
    const { distanceM, t } = pointToSegment(p, path.points[i], path.points[i + 1])
    if (!best || distanceM < best.distanceM) {
      best = { distanceM, alongM: path.cumulative[i] + t * (path.cumulative[i + 1] - path.cumulative[i]), segment: i }
    }
  }
  return best
}

/**
 * Snap during a trip. Looks near the previous position first (so a route that doubles back is not mistaken for a
 * later stretch), and only searches the whole route when the nearby stretch is clearly not where the person is.
 */
export function snapNear(path: RoutePath, p: LatLon, lastSegment: number, windowSegments = 40, lookBehind = 3): Snap | null {
  const near = snapToRoute(path, p, lastSegment - lookBehind, lastSegment + windowSegments)
  if (near && near.distanceM <= OFF_ROUTE_M) return near
  const all = snapToRoute(path, p)
  return all && (!near || all.distanceM < near.distanceM) ? all : near
}

/** The position `distanceM` metres along the route (clamped to its ends). Used by the simulated walk. */
export function pointAtDistance(path: RoutePath, distanceM: number): LatLon {
  if (path.points.length === 0) throw new Error('empty route')
  if (distanceM <= 0) return path.points[0]
  if (distanceM >= path.totalM) return path.points[path.points.length - 1]
  let i = 1
  while (i < path.cumulative.length - 1 && path.cumulative[i] < distanceM) i++
  const seg = path.cumulative[i] - path.cumulative[i - 1]
  const t = seg === 0 ? 0 : (distanceM - path.cumulative[i - 1]) / seg
  const a = path.points[i - 1]
  const b = path.points[i]
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }
}

/** Where along the route each step's manoeuvre happens. Searched forward only, so the list never goes backwards. */
export function stepPositions(path: RoutePath, steps: RouteStep[]): number[] {
  const out: number[] = []
  let seg = 0
  let prev = 0
  for (const s of steps) {
    const snap = snapToRoute(path, { lat: s.maneuver.lat, lon: s.maneuver.lon }, seg)
    const along = snap ? Math.max(prev, snap.alongM) : prev
    if (snap) seg = snap.segment
    out.push(along)
    prev = along
  }
  return out
}

/** Index of the step being followed: the last one whose manoeuvre point has been reached (a metre of slack). */
export function currentStepIndex(positions: number[], alongM: number): number {
  let idx = 0
  for (let i = 0; i < positions.length; i++) if (positions[i] <= alongM + 1) idx = i
  return idx
}

export function distanceRemaining(path: RoutePath, alongM: number): number {
  return Math.max(0, path.totalM - alongM)
}

/**
 * The next manoeuvre to speak: the first step ahead that is within `thresholdM` along the route and has not been
 * announced. The final "arrive" step is excluded; arrival has its own announcement.
 */
export function dueStep(positions: number[], alongM: number, announced: ReadonlySet<number>, thresholdM = ANNOUNCE_DISTANCE_M): number | null {
  for (let i = 1; i < positions.length - 1; i++) {
    if (announced.has(i)) continue
    const ahead = positions[i] - alongM
    if (ahead < -thresholdM) continue // already well behind us: skipped, never announced late
    if (ahead <= thresholdM) return i
    return null // steps are ordered, so nothing later can be nearer
  }
  return null
}

export interface OffRouteState {
  /** consecutive fixes farther than OFF_ROUTE_M from the route */
  count: number
  lastRerouteAt: number | null
}

export const INITIAL_OFF_ROUTE: OffRouteState = { count: 0, lastRerouteAt: null }

/**
 * Rerouting rule: more than 50 m from the route on 3 fixes in a row, and not more than once every 15 s.
 * One fix back on the route resets the count, so a single GPS spike never triggers a reroute.
 */
export function trackOffRoute(state: OffRouteState, distanceFromRouteM: number, nowMs: number): { state: OffRouteState; reroute: boolean } {
  if (!(distanceFromRouteM > OFF_ROUTE_M)) return { state: { count: 0, lastRerouteAt: state.lastRerouteAt }, reroute: false }
  const count = Math.min(state.count + 1, OFF_ROUTE_FIXES)
  const allowed = state.lastRerouteAt === null || nowMs - state.lastRerouteAt >= REROUTE_MIN_INTERVAL_MS
  if (count >= OFF_ROUTE_FIXES && allowed) return { state: { count: 0, lastRerouteAt: nowMs }, reroute: true }
  return { state: { count, lastRerouteAt: state.lastRerouteAt }, reroute: false }
}
