import { useMemo } from 'react'

export type DeviceStatus = 'connected' | 'disconnected' | 'not_integrated' | 'not_started' | 'unknown'
export type SosStatus = 'not_configured' | 'guardian_missing' | 'guardian_set'
export type ActivitySource = 'live' | 'simulation' | 'hardware'

export interface ActivityItem {
  id: string
  title: string
  detail?: string
  /** ISO timestamp. */
  at: string
  source: ActivitySource
}

export interface DashboardData {
  loading: boolean
  devices: {
    camera: DeviceStatus
    distanceSensor: DeviceStatus
    esp32Cam: DeviceStatus
    vibrationMotor: DeviceStatus
    battery: DeviceStatus
  }
  aiAssistance: DeviceStatus
  sos: SosStatus
  recent: {
    obstacles: ActivityItem[]
    navigation: ActivityItem[]
    rides: ActivityItem[]
    emergencies: ActivityItem[]
  }
}

/** What is honestly true before any backend data exists (spec section 3 and the honesty rules). */
export const EMPTY_DASHBOARD: DashboardData = {
  loading: false,
  devices: {
    camera: 'not_started',
    distanceSensor: 'disconnected',
    esp32Cam: 'not_integrated',
    vibrationMotor: 'not_integrated',
    battery: 'not_integrated',
  },
  aiAssistance: 'not_started',
  sos: 'not_configured',
  recent: { obstacles: [], navigation: [], rides: [], emergencies: [] },
}

/**
 * Single seam for dashboard data. Task 6 (devices) and Task 7 (events) replace the
 * body with react-query calls and merge real values over these empty defaults; the
 * Dashboard component only reads the returned shape.
 */
export function useDashboardData(): DashboardData {
  return useMemo(() => EMPTY_DASHBOARD, [])
}
