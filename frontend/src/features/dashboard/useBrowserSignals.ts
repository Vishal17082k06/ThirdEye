import { useEffect, useState } from 'react'

export type GpsState = 'unknown' | 'not_checked' | 'granted' | 'denied'

/**
 * Reads the browser's geolocation permission without prompting the user.
 * 'granted' means permission only; it does not mean a location fix exists.
 */
export function useGpsPermission(): GpsState {
  const [state, setState] = useState<GpsState>(() =>
    typeof navigator !== 'undefined' && navigator.permissions ? 'not_checked' : 'unknown',
  )

  useEffect(() => {
    if (!navigator.permissions) return
    let status: PermissionStatus | undefined
    let cancelled = false
    const map = (s: PermissionState): GpsState => (s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'not_checked')
    const onChange = () => status && setState(map(status.state))
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((s) => {
        if (cancelled) return
        status = s
        setState(map(s.state))
        s.addEventListener('change', onChange)
      })
      .catch(() => !cancelled && setState('unknown'))
    return () => {
      cancelled = true
      status?.removeEventListener('change', onChange)
    }
  }, [])

  return state
}

/** True when the browser offers the Web Speech recognition API (Chrome and Edge today). */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
}
