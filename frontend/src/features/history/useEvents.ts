import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

export type EventType =
  | 'obstacle'
  | 'ai_analysis'
  | 'camera_session'
  | 'navigation'
  | 'ride'
  | 'sos'
  | 'device'
  | 'distance_reading'
export type EventSource = 'live' | 'simulation' | 'hardware'

export interface ActivityEvent {
  id: number
  type: EventType
  source: EventSource
  title: string
  details: Record<string, unknown>
  status: string
  created_at: string
}

export interface EventsPage {
  items: ActivityEvent[]
  total: number
  limit: number
  offset: number
}

export interface EventFilters {
  type?: EventType | ''
  source?: EventSource | ''
  q?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export const EVENT_TYPES: Array<{ value: EventType; label: string }> = [
  { value: 'obstacle', label: 'Obstacle detections' },
  { value: 'ai_analysis', label: 'AI image analysis' },
  { value: 'camera_session', label: 'Camera sessions' },
  { value: 'navigation', label: 'Navigation sessions' },
  { value: 'ride', label: 'Ride requests' },
  { value: 'sos', label: 'Emergency SOS' },
  { value: 'device', label: 'Device connection' },
  { value: 'distance_reading', label: 'Distance sensor readings' },
]

export const PAGE_SIZE = 20

/** Builds the query string for GET /api/events; empty filters are left out. */
export function buildEventsQuery(f: EventFilters): string {
  const p = new URLSearchParams()
  if (f.type) p.set('type', f.type)
  if (f.source) p.set('source', f.source)
  if (f.q?.trim()) p.set('q', f.q.trim())
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.limit !== undefined) p.set('limit', String(f.limit))
  if (f.offset !== undefined) p.set('offset', String(f.offset))
  return p.toString()
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

/** Paged history with "load more" (offset pagination). */
export function useEventsHistory(filters: EventFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['events', 'history', filters],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<EventsPage>(`/events?${buildEventsQuery({ ...filters, limit: PAGE_SIZE, offset: pageParam })}`),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total && last.items.length > 0 ? loaded : undefined
    },
  })
}

/** A short list of recent events of one type, for the dashboard. */
export function useRecentEvents(type: EventType, limit = 5) {
  return useQuery({
    queryKey: ['events', 'recent', type, limit],
    queryFn: () => api.get<EventsPage>(`/events?${buildEventsQuery({ type, limit })}`),
    refetchInterval: 30_000,
  })
}
