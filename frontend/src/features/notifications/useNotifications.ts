import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'

export interface AppNotification {
  id: number
  kind: string
  title: string
  body: string
  source: 'live' | 'simulation' | 'hardware'
  read: boolean
  created_at: string
}

export interface NotificationsResponse {
  items: AppNotification[]
  unread_count: number
}

export const NOTIFICATIONS_KEY = ['notifications'] as const
export const NOTIFICATION_POLL_MS = 20_000

export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => api.get<NotificationsResponse>('/notifications'),
    refetchInterval: NOTIFICATION_POLL_MS,
    refetchOnWindowFocus: 'always',
  })
}

export function useNotificationActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
  const markRead = useMutation({
    mutationFn: (id: number) => api.post<AppNotification>(`/notifications/${id}/read`),
    onSuccess: refresh,
  })
  const markAllRead = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: refresh,
  })
  const clearAll = useMutation({
    mutationFn: () => api.delete<{ deleted: number }>('/notifications'),
    onSuccess: refresh,
  })
  return { markRead, markAllRead, clearAll }
}
