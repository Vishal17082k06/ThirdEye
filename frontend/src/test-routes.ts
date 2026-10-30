import type { RouteResult, RouteMode } from './features/maps/api'

interface P {
  lat: number
  lon: number
}

/** A straight 10-segment route from a to b with three steps: depart, a turn at the midpoint, arrive. */
export function makeRoute(mode: RouteMode, a: P, b: P, opts: { distance_m?: number; duration_s?: number } = {}): RouteResult {
  const pts: P[] = []
  for (let i = 0; i <= 10; i++) pts.push({ lat: a.lat + ((b.lat - a.lat) * i) / 10, lon: a.lon + ((b.lon - a.lon) * i) / 10 })
  const mid = pts[5]
  return {
    mode,
    distance_m: opts.distance_m ?? 2100,
    duration_s: opts.duration_s ?? 1500,
    geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) },
    steps: [
      { instruction: 'Head south on Avinashi Road', distance_m: 1000, duration_s: 700, maneuver: { type: 'depart', modifier: null, lat: a.lat, lon: a.lon }, name: 'Avinashi Road' },
      { instruction: 'Turn left onto Race Course Road', distance_m: 1100, duration_s: 800, maneuver: { type: 'turn', modifier: 'left', lat: mid.lat, lon: mid.lon }, name: 'Race Course Road' },
      { instruction: 'You have arrived at your destination', distance_m: 0, duration_s: 0, maneuver: { type: 'arrive', modifier: null, lat: b.lat, lon: b.lon }, name: '' },
    ],
    provider: 'OSRM (routing.openstreetmap.de)',
  }
}

export function routePoints(route: RouteResult): P[] {
  return route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }))
}
