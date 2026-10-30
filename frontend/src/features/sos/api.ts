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

/** The backend may spend up to ~40 s talking to the mail server; past this we stop waiting and say the outcome is unknown. */
export const SOS_TIMEOUT_MS = 60_000

async function postWithTimeout<T>(path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SOS_TIMEOUT_MS)
  try {
    return await api.post<T>(path, body, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export const postSos = (body: SosRequestBody) => postWithTimeout<SosRecord>('/sos', body)
export const retrySos = (id: number) => postWithTimeout<SosRecord>(`/sos/${id}/retry`)

/** Only ever render a Google Maps link the server built; anything else is treated as "no link". */
export function safeMapsLink(link: string | null | undefined): string | null {
  return link && link.startsWith('https://www.google.com/maps') ? link : null
}
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
