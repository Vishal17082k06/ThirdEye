import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'

export type DeviceStatusValue = 'connected' | 'disconnected' | 'not_integrated' | 'unknown' | 'error'
export type DeviceKey = 'laptop_camera' | 'esp32_cam' | 'vl53l0x' | 'vibration_motor' | 'battery'

export interface Device {
  key: DeviceKey
  name: string
  /** Effective status computed by the server (including staleness); render as given. */
  status: DeviceStatusValue
  last_seen: string | null
  config: Record<string, unknown>
  error: string | null
  /** Info sent with the latest hardware heartbeat (server stores it separately from config). */
  lastInfo?: Record<string, unknown> | null
}

export const DEVICES_KEY = ['devices'] as const
export const DEVICE_POLL_MS = 10_000

export function useDevices() {
  return useQuery({
    queryKey: DEVICES_KEY,
    queryFn: async () => (await api.get<{ items: Device[] }>('/devices')).items,
    refetchInterval: DEVICE_POLL_MS,
    refetchOnWindowFocus: true,
  })
}

function replaceDevice(qc: ReturnType<typeof useQueryClient>, d: Device) {
  qc.setQueryData<Device[]>(DEVICES_KEY, (old) => (old ? old.map((x) => (x.key === d.key ? d : x)) : old))
}

export function useSaveDeviceConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, config }: { key: DeviceKey; config: Record<string, unknown> }) =>
      api.put<Device>(`/devices/${key}`, { config }),
    onSuccess: (d) => replaceDevice(qc, d),
  })
}

export type CameraReport = { status: 'connected' | 'disconnected' | 'error'; error?: string }

export function useReportLaptopCamera() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CameraReport) => api.post<Device>('/devices/laptop_camera/report', body),
    onSuccess: (d) => {
      replaceDevice(qc, d)
      void qc.invalidateQueries({ queryKey: ['events'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/** Really opens the camera for a moment, stops it, and says what happened. Never fakes a result. */
export async function probeCamera(): Promise<CameraReport> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { status: 'error', error: 'This browser cannot access cameras (it needs https or localhost).' }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.getTracks().forEach((t) => t.stop())
    return { status: 'connected' }
  } catch (err) {
    const name = (err as DOMException)?.name
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { status: 'disconnected', error: 'No camera was found on this device.' }
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { status: 'error', error: 'Camera permission was denied in the browser.' }
    }
    if (name === 'NotReadableError') {
      return { status: 'error', error: 'The camera is in use by another application or could not be started.' }
    }
    return { status: 'error', error: 'The camera could not be opened.' }
  }
}
