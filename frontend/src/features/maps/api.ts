import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import {
  DEFAULT_BOUNDS,
  DEFAULT_CENTRE,
  inServiceArea,
  SERVICE_AREA_MESSAGE,
  type Bounds,
  type LatLon,
} from '../../lib/geo'

export interface Place extends LatLon {
  label: string
}

export interface ServiceArea {
  bounds: Bounds
  centre: LatLon
  message: string
}

export const FALLBACK_AREA: ServiceArea = { bounds: DEFAULT_BOUNDS, centre: DEFAULT_CENTRE, message: SERVICE_AREA_MESSAGE }

/** The routing provider's profile names. Ride requests use walk | car | bike; "walk" is "foot" here. */
export type RouteMode = 'foot' | 'car' | 'bike'
export type RideMode = 'walk' | 'car' | 'bike'

export const rideModeToRoute = (m: RideMode): RouteMode => (m === 'walk' ? 'foot' : m)

export interface RouteStep {
  instruction: string
  distance_m: number
  duration_s: number
  maneuver: { type: string; modifier: string | null; lat: number; lon: number }
  name: string
}

export interface RouteResult {
  mode: RouteMode
  distance_m: number
  duration_s: number
  geometry: { type: 'LineString'; coordinates: number[][] }
  steps: RouteStep[]
  provider: string
}

export interface GeocodeResult {
  label: string
  lat: number
  lon: number
  kind: string
}

interface BoundsResponse {
  bounds: Bounds
  centre: LatLon
  message: string
}

/** Service area from the server; the hard-coded Coimbatore box is used if the call has not answered (or failed). */
export function useServiceArea(): ServiceArea {
  const q = useQuery({
    queryKey: ['nav', 'bounds'],
    queryFn: () => api.get<BoundsResponse>('/nav/bounds'),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  })
  const data = q.data
  return useMemo(
    () => (data ? { bounds: data.bounds, centre: data.centre, message: data.message || SERVICE_AREA_MESSAGE } : FALLBACK_AREA),
    [data],
  )
}

export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<string> {
  const res = await api.get<{ label: string }>(`/nav/reverse?lat=${lat}&lon=${lon}`, { signal })
  return res.label
}

/**
 * Fetches a route. Both ends are checked here first, so an out-of-area trip never leaves the browser; the server
 * enforces the same rule and answers 422 with the same restriction message.
 */
export async function fetchRoute(
  from: LatLon,
  to: LatLon,
  mode: RouteMode,
  signal?: AbortSignal,
  area: ServiceArea = FALLBACK_AREA,
): Promise<RouteResult> {
  if (!inServiceArea(from.lat, from.lon, area.bounds) || !inServiceArea(to.lat, to.lon, area.bounds)) {
    throw new ApiError(422, area.message)
  }
  const qs = new URLSearchParams({
    from_lat: String(from.lat),
    from_lon: String(from.lon),
    to_lat: String(to.lat),
    to_lon: String(to.lon),
    mode,
  })
  return api.get<RouteResult>(`/nav/route?${qs.toString()}`, { signal })
}

/** A message a person can act on, for any failure from the navigation endpoints. */
export function navErrorMessage(err: unknown, what: 'route' | 'search' | 'address' = 'route'): string {
  if (err instanceof ApiError) {
    if (err.status === 502 || err.status === 503) {
      if (what === 'search') return 'Place search is unavailable right now. You can still click the map or enter coordinates.'
      if (what === 'address') return 'The address lookup service is unavailable right now. Try again.'
      return 'Routing service is unavailable right now. Try again.'
    }
    return err.message
  }
  return 'Something went wrong. Try again.'
}

export const DEBOUNCE_MS = 400
export const MIN_QUERY = 2

export type GeocodeStatus = 'idle' | 'loading' | 'ok' | 'error'

/** Debounced (400 ms), abortable place search. Fewer than two characters never calls the server. */
export function useGeocode(q: string) {
  const trimmed = q.trim()
  const [state, setState] = useState<{
    forQuery: string
    status: GeocodeStatus
    results: GeocodeResult[]
    note: string | null
    error: string | null
  }>({ forQuery: '', status: 'idle', results: [], note: null, error: null })

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState((s) => ({ ...s, forQuery: trimmed, status: 'loading', error: null }))
      api
        .get<{ results: GeocodeResult[]; note: string | null }>(`/nav/geocode?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        })
        .then((res) =>
          setState({ forQuery: trimmed, status: 'ok', results: res.results ?? [], note: res.note ?? null, error: null }),
        )
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setState({ forQuery: trimmed, status: 'error', results: [], note: null, error: navErrorMessage(err, 'search') })
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed])

  if (trimmed.length < MIN_QUERY) return { status: 'idle' as GeocodeStatus, results: [] as GeocodeResult[], note: null, error: null }
  // While a newer query is waiting out its debounce, never show the previous query's answers as if they matched.
  if (state.forQuery !== trimmed) return { status: 'loading' as GeocodeStatus, results: [] as GeocodeResult[], note: null, error: null }
  return state
}
