import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Place, RideMode } from '../maps/api'

export const RIDE_DISCLAIMER = 'Third Eye ride request (demo). No driver is assigned and no real ride is booked.'

export type RideStatus = 'requested' | 'cancelled'

export interface RidePlace {
  lat: number
  lon: number
  label: string
}

export interface Ride {
  id: number
  booking_id: string
  pickup: RidePlace
  destination: RidePlace
  mode: RideMode
  distance_m: number
  duration_s: number
  fare_estimate: number | null
  fare_note: string | null
  status: RideStatus
  created_at: string
  disclaimer: string
  /** Which mode the request was made in. Older records may not carry it. */
  source?: 'live' | 'simulation'
}

export interface RideList {
  items: Ride[]
  total: number
  limit: number
  offset: number
}

export interface CreateRideInput {
  pickup: Place
  destination: Place
  mode: RideMode
  distance_m: number
  duration_s: number
  source: 'live' | 'simulation'
}

export const RIDES_KEY = ['rides'] as const

export function useRides() {
  return useQuery({ queryKey: [...RIDES_KEY, 'list'], queryFn: () => api.get<RideList>('/rides?limit=50') })
}

/** The server answers 201 for a new request and 200 when it recognises an identical one just sent; both are success. */
export function useCreateRide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateRideInput) =>
      api.post<Ride>('/rides', {
        pickup: { lat: input.pickup.lat, lon: input.pickup.lon, label: input.pickup.label },
        destination: { lat: input.destination.lat, lon: input.destination.lon, label: input.destination.label },
        mode: input.mode,
        distance_m: input.distance_m,
        duration_s: input.duration_s,
        source: input.source,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: RIDES_KEY }),
  })
}

export function useCancelRide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<Ride>(`/rides/${id}/cancel`),
    // On 409 (already not "requested") the list is stale, so refresh it either way.
    onSettled: () => qc.invalidateQueries({ queryKey: RIDES_KEY }),
  })
}
