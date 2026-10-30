import { api } from './api'

export type ClientEventType =
  | 'obstacle'
  | 'ai_analysis'
  | 'camera_session'
  | 'navigation'
  | 'ride'
  | 'distance_reading'
export type ClientEventSource = 'live' | 'simulation'

export interface ClientEventInput {
  type: ClientEventType
  source: ClientEventSource
  title: string
  details?: Record<string, unknown>
  status?: string
  /** Ask the server to also raise a notification (used for high-risk simulated events). */
  notify?: boolean
}

/** Records one client-side event through POST /api/events. Failures are returned, never thrown, so UI keeps working. */
export async function postEvent(input: ClientEventInput): Promise<boolean> {
  try {
    await api.post('/events', input)
    return true
  } catch {
    return false
  }
}
