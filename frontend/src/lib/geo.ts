/** Plain geographic helpers shared by the maps, navigation and ride features. No React in here. */

export interface LatLon {
  lat: number
  lon: number
}

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

/** Used until (or if) GET /api/nav/bounds answers; it mirrors the server's Coimbatore service area. */
export const DEFAULT_CENTRE: LatLon = { lat: 11.0168, lon: 76.9558 }
export const DEFAULT_BOUNDS: Bounds = { south: 10.85, west: 76.85, north: 11.15, east: 77.15 }

/** The same wording the server uses, so a client-side refusal reads exactly like a server 422. */
export const SERVICE_AREA_MESSAGE =
  'Third Eye navigation is currently limited to Coimbatore, Tamil Nadu. Please choose a place inside the Coimbatore service area.'

const EARTH_RADIUS_M = 6_371_000

/** True when lat/lon are finite numbers on the globe. NaN, Infinity and out-of-range values are not coordinates. */
export function isValidCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

/**
 * Whether a point is inside the service rectangle. Edges are inclusive, and anything that is not a real coordinate
 * (NaN, swapped lat/lon that fall off the globe, ...) is outside. Swapped values such as (76.9, 11.0) are outside
 * simply because 76.9 is not a latitude inside the box.
 */
export function inServiceArea(lat: number, lon: number, bounds: Bounds = DEFAULT_BOUNDS): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false
  if (!isValidCoordinate(lat, lon)) return false
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east
}

/** Great-circle distance in metres. */
export function haversineM(a: LatLon, b: LatLon): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLon = (b.lon - a.lon) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** "850 m" under a kilometre, "1.2 km" above, "12 km" from ten kilometres. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '—'
  if (metres < 1000) return `${Math.round(metres / 10) * 10 || Math.round(metres)} m`
  const km = metres / 1000
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

/** "45 sec", "12 min", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Local clock time (e.g. "4:35 pm") at which a trip of `seconds` that starts at `from` would end. */
export function arrivalClock(seconds: number, from: Date = new Date()): string {
  const at = new Date(from.getTime() + seconds * 1000)
  return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function coordinateLabel(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}
