import { describe, expect, it } from 'vitest'
import { haversineM } from '../../lib/geo'
import type { RouteStep } from '../maps/api'
import {
  announceDistanceFor,
  buildPath,
  currentStepIndex,
  distanceRemaining,
  dueStep,
  INITIAL_OFF_ROUTE,
  pointAtDistance,
  pointToSegment,
  snapNear,
  snapToRoute,
  stepPositions,
  trackOffRoute,
} from './geometry'

// A straight road going north from (11.000, 77.000), then a turn east: about 1112 m north + 1090 m east.
const NORTH: [number, number][] = [
  [11.0, 77.0],
  [11.005, 77.0],
  [11.01, 77.0],
]
const L_SHAPE: [number, number][] = [...NORTH, [11.01, 77.005], [11.01, 77.01]]

describe('pointToSegment', () => {
  const a = { lat: 11.0, lon: 77.0 }
  const b = { lat: 11.01, lon: 77.0 }
  it('measures the perpendicular distance', () => {
    const p = { lat: 11.005, lon: 77.0 + 0.0005 } // about 54.5 m east of the road
    const r = pointToSegment(p, a, b)
    expect(r.distanceM).toBeCloseTo(haversineM({ lat: 11.005, lon: 77.0 }, p), 0)
    expect(r.t).toBeCloseTo(0.5, 2)
  })
  it('clamps to the end points', () => {
    expect(pointToSegment({ lat: 10.99, lon: 77.0 }, a, b).t).toBe(0)
    expect(pointToSegment({ lat: 11.02, lon: 77.0 }, a, b).t).toBe(1)
    expect(pointToSegment({ lat: 10.99, lon: 77.0 }, a, b).distanceM).toBeCloseTo(haversineM({ lat: 10.99, lon: 77 }, a), 0)
  })
  it('handles a zero-length segment', () => {
    expect(pointToSegment({ lat: 11.001, lon: 77.0 }, a, a).distanceM).toBeCloseTo(111.2, 0)
  })
})

describe('snapToRoute / progress', () => {
  const path = buildPath(L_SHAPE)
  it('builds cumulative distances', () => {
    expect(path.cumulative[0]).toBe(0)
    expect(path.totalM).toBeGreaterThan(2100)
    expect(path.totalM).toBeLessThan(2300)
  })
  it('snaps a point on the first leg', () => {
    const s = snapToRoute(path, { lat: 11.0025, lon: 77.0 })!
    expect(s.distanceM).toBeLessThan(1)
    expect(s.alongM).toBeCloseTo(278, 0)
  })
  it('snaps onto the east leg and measures distance remaining', () => {
    const s = snapToRoute(path, { lat: 11.01, lon: 77.0075 })!
    expect(s.segment).toBe(3)
    expect(distanceRemaining(path, s.alongM)).toBeCloseTo(path.totalM - s.alongM, 5)
    expect(distanceRemaining(path, s.alongM)).toBeCloseTo(273, -1)
  })
  it('reports how far off the route a point is', () => {
    const s = snapToRoute(path, { lat: 11.0025, lon: 77.001 })!
    expect(s.distanceM).toBeGreaterThan(100)
  })
  it('never reports a negative remaining distance', () => {
    expect(distanceRemaining(path, path.totalM + 50)).toBe(0)
  })
  it('snapNear prefers the stretch near the last position on a route that doubles back', () => {
    const loop = buildPath([
      [11.0, 77.0],
      [11.01, 77.0],
      [11.01, 77.0001],
      [11.0, 77.0001],
    ])
    // equally close to the outbound and the return leg; the last known segment decides
    expect(snapNear(loop, { lat: 11.005, lon: 77.00005 }, 0, 0, 0)!.segment).toBe(0)
    expect(snapNear(loop, { lat: 11.005, lon: 77.00005 }, 2, 0, 0)!.segment).toBe(2)
  })
  it('snapNear falls back to the whole route when the person is elsewhere', () => {
    const s = snapNear(path, { lat: 11.01, lon: 77.009 }, 0, 1)!
    expect(s.segment).toBe(3)
  })
  it('returns null for a route with fewer than two points', () => {
    expect(snapToRoute(buildPath([[11, 77]]), { lat: 11, lon: 77 })).toBeNull()
  })
})

describe('pointAtDistance', () => {
  const path = buildPath(L_SHAPE)
  it('walks along the route and clamps at both ends', () => {
    expect(pointAtDistance(path, -5)).toEqual({ lat: 11.0, lon: 77.0 })
    expect(pointAtDistance(path, 1e9)).toEqual({ lat: 11.01, lon: 77.01 })
    const mid = pointAtDistance(path, 278)
    expect(mid.lat).toBeCloseTo(11.0025, 4)
    expect(mid.lon).toBeCloseTo(77.0, 6)
    const around = pointAtDistance(path, path.cumulative[3] + 100)
    expect(around.lat).toBeCloseTo(11.01, 5)
    expect(around.lon).toBeGreaterThan(77.0049)
  })
  it('round-trips with snapToRoute', () => {
    const p = pointAtDistance(path, 1500)
    expect(snapToRoute(path, p)!.alongM).toBeCloseTo(1500, 0)
  })
})

const step = (lat: number, lon: number, type = 'turn'): RouteStep => ({
  instruction: `${type} at ${lat}`,
  distance_m: 0,
  duration_s: 0,
  maneuver: { type, modifier: null, lat, lon },
  name: '',
})

describe('steps', () => {
  const path = buildPath(L_SHAPE)
  const steps = [step(11.0, 77.0, 'depart'), step(11.01, 77.0, 'turn'), step(11.01, 77.01, 'arrive')]
  const pos = stepPositions(path, steps)

  it('places each manoeuvre along the route in order', () => {
    expect(pos[0]).toBeCloseTo(0, 0)
    expect(pos[1]).toBeCloseTo(path.cumulative[2], 0)
    expect(pos[2]).toBeCloseTo(path.totalM, 0)
  })
  it('finds the current step from distance travelled', () => {
    expect(currentStepIndex(pos, 0)).toBe(0)
    expect(currentStepIndex(pos, 500)).toBe(0)
    expect(currentStepIndex(pos, pos[1] + 5)).toBe(1)
    expect(currentStepIndex(pos, pos[2])).toBe(2)
  })
  it('announces a manoeuvre only within 40 m, and only once', () => {
    const announced = new Set<number>()
    expect(dueStep(pos, pos[1] - 100, announced)).toBeNull()
    expect(dueStep(pos, pos[1] - 39, announced)).toBe(1)
    announced.add(1)
    expect(dueStep(pos, pos[1] - 10, announced)).toBeNull()
  })
  it('never announces the final arrive step as a manoeuvre', () => {
    expect(dueStep(pos, pos[2] - 10, new Set([1]))).toBeNull()
  })
  it('does not announce a manoeuvre that is already well behind', () => {
    expect(dueStep(pos, pos[1] + 200, new Set())).toBeNull()
  })
  it('handles no steps', () => {
    expect(stepPositions(path, [])).toEqual([])
    expect(currentStepIndex([], 10)).toBe(0)
    expect(dueStep([], 0, new Set())).toBeNull()
  })
})

describe('trackOffRoute (reroute rules)', () => {
  it('reroutes only on the third consecutive fix beyond 50 m', () => {
    let r = trackOffRoute(INITIAL_OFF_ROUTE, 80, 1000)
    expect(r.reroute).toBe(false)
    r = trackOffRoute(r.state, 80, 2000)
    expect(r.reroute).toBe(false)
    r = trackOffRoute(r.state, 80, 3000)
    expect(r.reroute).toBe(true)
    expect(r.state.count).toBe(0)
  })
  it('a fix back on the route resets the count', () => {
    let r = trackOffRoute(INITIAL_OFF_ROUTE, 80, 1000)
    r = trackOffRoute(r.state, 80, 2000)
    r = trackOffRoute(r.state, 10, 3000)
    r = trackOffRoute(r.state, 80, 4000)
    r = trackOffRoute(r.state, 80, 5000)
    expect(r.reroute).toBe(false)
  })
  it('exactly 50 m is still on the route', () => {
    let r = trackOffRoute(INITIAL_OFF_ROUTE, 50, 1)
    r = trackOffRoute(r.state, 50, 2)
    r = trackOffRoute(r.state, 50, 3)
    expect(r.reroute).toBe(false)
  })
  it('allows at most one reroute per 15 s, then fires as soon as the interval has passed', () => {
    let r = trackOffRoute(INITIAL_OFF_ROUTE, 90, 0)
    r = trackOffRoute(r.state, 90, 1000)
    r = trackOffRoute(r.state, 90, 2000)
    expect(r.reroute).toBe(true)
    // still lost right after: more bad fixes inside the 15 s window do not trigger
    r = trackOffRoute(r.state, 90, 3000)
    r = trackOffRoute(r.state, 90, 4000)
    r = trackOffRoute(r.state, 90, 5000)
    r = trackOffRoute(r.state, 90, 6000)
    expect(r.reroute).toBe(false)
    r = trackOffRoute(r.state, 90, 16_999)
    expect(r.reroute).toBe(false)
    r = trackOffRoute(r.state, 90, 17_000)
    expect(r.reroute).toBe(true)
  })
  it('treats NaN distance as not off-route', () => {
    expect(trackOffRoute(INITIAL_OFF_ROUTE, NaN, 0).state.count).toBe(0)
  })
})

describe('announceDistanceFor', () => {
  it('scales the warning distance with the travel mode', () => {
    expect(announceDistanceFor('foot')).toBe(40)
    expect(announceDistanceFor('bike')).toBe(60)
    expect(announceDistanceFor('car')).toBe(120)
  })
})
