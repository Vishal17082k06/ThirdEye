import { useMemo } from 'react'
import { guardianIsSet, useGuardian } from '../account/useAccount'
import { useDevices, type Device, type DeviceKey } from '../devices/useDevices'
import { useRecentEvents, type ActivityEvent } from '../history/useEvents'

export type DeviceStatus = 'connected' | 'disconnected' | 'not_integrated' | 'not_started' | 'unknown' | 'error' | 'checking'
export type SosStatus = 'not_configured' | 'guardian_missing' | 'guardian_set' | 'checking' | 'unknown'
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

const toItem = (e: ActivityEvent): ActivityItem => ({
  id: String(e.id),
  title: e.title,
  detail: e.status === 'failed' ? 'Failed: this did not complete. Open Emergency SOS to retry or call your guardian.' : e.status && e.status !== 'ok' ? `Status: ${e.status}` : undefined,
  at: e.created_at,
  source: e.source,
})

/**
 * Single seam for dashboard data: real devices, guardian and recent events from the API.
 * While a request is pending the status is "checking" (never a guessed value); if it fails the
 * status is "unknown". Empty recent-activity lists keep their empty states.
 */
export function useDashboardData(): DashboardData {
  const devices = useDevices()
  const guardian = useGuardian()
  const obstacles = useRecentEvents('obstacle')
  const navigation = useRecentEvents('navigation')
  const rides = useRecentEvents('ride')
  const sos = useRecentEvents('sos')

  return useMemo(() => {
    const byKey = new Map<DeviceKey, Device>((devices.data ?? []).map((d) => [d.key, d]))
    const pick = (key: DeviceKey, fallback: DeviceStatus): DeviceStatus => {
      const d = byKey.get(key)
      if (d) return d.status
      if (devices.isError) return 'unknown'
      return devices.isPending ? 'checking' : fallback
    }
    const d = EMPTY_DASHBOARD.devices
    return {
      loading: devices.isPending,
      devices: {
        camera: pick('laptop_camera', d.camera),
        distanceSensor: pick('vl53l0x', d.distanceSensor),
        esp32Cam: pick('esp32_cam', d.esp32Cam),
        vibrationMotor: pick('vibration_motor', d.vibrationMotor),
        battery: pick('battery', d.battery),
      },
      aiAssistance: EMPTY_DASHBOARD.aiAssistance,
      sos: guardian.data
        ? guardianIsSet(guardian.data)
          ? 'guardian_set'
          : 'guardian_missing'
        : guardian.isError
          ? 'unknown'
          : 'checking',
      recent: {
        obstacles: (obstacles.data?.items ?? []).map(toItem),
        navigation: (navigation.data?.items ?? []).map(toItem),
        rides: (rides.data?.items ?? []).map(toItem),
        emergencies: (sos.data?.items ?? []).map(toItem),
      },
    }
  }, [devices.data, devices.isError, devices.isPending, guardian.data, guardian.isError, obstacles.data, navigation.data, rides.data, sos.data])
}
