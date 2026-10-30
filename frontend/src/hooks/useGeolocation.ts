import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_BOUNDS, inServiceArea, type Bounds } from '../lib/geo'

export type GeoStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'timeout'

export interface GeoFix {
  lat: number
  lon: number
  /** Horizontal accuracy radius in metres, when the device reports it. */
  accuracy: number | null
  timestamp: number
}

export const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 }

export const GPS_UNAVAILABLE_MESSAGE = 'GPS not available on this device or browser.'

/** Turns a GeolocationPositionError code into a status and a sentence a person can act on. */
export function describeGeoError(code: number | undefined): { status: GeoStatus; message: string } {
  switch (code) {
    case 1:
      return { status: 'denied', message: 'Location permission was denied. Allow location access in your browser settings, or choose your location manually.' }
    case 3:
      return { status: 'timeout', message: 'GPS signal lost: the device did not report a position in time. Trying again.' }
    default:
      return { status: 'unavailable', message: 'GPS not available: your position could not be determined. You can choose your location manually.' }
  }
}

function toFix(p: GeolocationPosition): GeoFix {
  return {
    lat: p.coords.latitude,
    lon: p.coords.longitude,
    accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
    timestamp: p.timestamp || Date.now(),
  }
}

/** One-shot position, for buttons such as "Use current location". Rejects with a GeoFailure. */
export interface GeoFailure {
  status: GeoStatus
  message: string
}

export function locateOnce(): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject({ status: 'unavailable', message: GPS_UNAVAILABLE_MESSAGE } satisfies GeoFailure)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toFix(p)),
      (e) => reject(describeGeoError(e?.code) satisfies GeoFailure),
      { ...GEO_OPTIONS, maximumAge: 5000, timeout: 12_000 },
    )
  })
}

/**
 * Live GPS through watchPosition.
 * - `enabled: false` never touches the geolocation API (Simulation mode relies on that).
 * - The watch is cleared on unmount and whenever `enabled` turns off.
 * - A permission refusal ends the watch; "unavailable" and "timeout" keep it so a returning signal recovers by itself.
 * - `inArea` says whether the latest fix is inside the service area (null while there is no fix).
 */
export function useGeolocation(enabled = true, bounds: Bounds = DEFAULT_BOUNDS) {
  const [status, setStatus] = useState<GeoStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [position, setPosition] = useState<GeoFix | null>(null)
  const [attempt, setAttempt] = useState(0)
  const watchId = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable')
      setMessage(GPS_UNAVAILABLE_MESSAGE)
      return
    }
    const geo = navigator.geolocation
    setStatus('requesting')
    setMessage(null)
    const id = geo.watchPosition(
      (p) => {
        setPosition(toFix(p))
        setStatus('active')
        setMessage(null)
      },
      (e) => {
        const d = describeGeoError(e?.code)
        setStatus(d.status)
        setMessage(d.message)
        if (d.status === 'denied') {
          geo.clearWatch(id)
          watchId.current = null
        }
      },
      GEO_OPTIONS,
    )
    watchId.current = id
    return () => {
      geo.clearWatch(id)
      watchId.current = null
    }
  }, [enabled, attempt])

  const retry = useCallback(() => {
    setPosition(null)
    setAttempt((n) => n + 1)
  }, [])

  const off = !enabled
  const inArea = !off && position ? inServiceArea(position.lat, position.lon, bounds) : null
  return {
    status: off ? ('idle' as GeoStatus) : status,
    message: off ? null : message,
    position: off ? null : position,
    accuracy: off ? null : (position?.accuracy ?? null),
    inArea,
    retry,
  }
}
