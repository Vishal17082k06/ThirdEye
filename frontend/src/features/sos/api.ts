import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

export type SosDelivery = 'pending' | 'sent' | 'failed'

/** The server's SosOut. Everything shown about delivery comes from these fields, never from the client. */
export interface SosRecord {
  id: number
  created_at: string
  status: SosDelivery
  lat: number | null
  lon: number | null
  accuracy_m: number | null
  maps_link: string | null
  guardian_name: string | null
  guardian_email: string | null
  attempts: number
  error: string | null
  sent_at: string | null
  note: string | null
  delivery_message: string
  retry_available: boolean
}

export interface SosList {
  items: SosRecord[]
  total: number
  limit: number
  offset: number
}

export interface SosStatus {
  email_configured: boolean
  guardian_ready: boolean
  guardian_name: string | null
}

export interface SosRequestBody {
  lat?: number
  lon?: number
  accuracy_m?: number
  note?: string
}

export const SOS_STATUS_KEY = ['sos', 'status'] as const
export const SOS_LIST_KEY = ['sos', 'list'] as const
export const sosOneKey = (id: number) => ['sos', 'one', id] as const

export const POLL_MS = 3000

export const postSos = (body: SosRequestBody) => api.post<SosRecord>('/sos', body)
export const retrySos = (id: number) => api.post<SosRecord>(`/sos/${id}/retry`)
export const fetchSos = (id: number) => api.get<SosRecord>(`/sos/${id}`)

export function useSosStatus(enabled = true) {
  return useQuery({ queryKey: SOS_STATUS_KEY, queryFn: () => api.get<SosStatus>('/sos/status'), enabled, staleTime: 15_000 })
}

/** History, newest first. Polls every few seconds while any row is still pending, and stops otherwise. */
export function useSosHistory(enabled = true) {
  return useQuery({
    queryKey: SOS_LIST_KEY,
    queryFn: () => api.get<SosList>('/sos?limit=50'),
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === 'pending') ? POLL_MS : false),
  })
}

/** A tel: href from a phone number as people type it (spaces, dashes, brackets removed). */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^\d+]/g, '')
  return digits.replace(/\D/g, '').length >= 3 ? `tel:${digits}` : null
}
