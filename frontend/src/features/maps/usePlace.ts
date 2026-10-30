import { useCallback, useRef, useState } from 'react'
import { coordinateLabel, inServiceArea, isValidCoordinate } from '../../lib/geo'
import { reverseGeocode, type Place, type ServiceArea } from './api'

interface Controlled {
  value: Place | null
  set: (p: Place | null) => void
}

/**
 * One chosen place (pickup, destination, manual start). Every way of choosing - a search result, a map click or typed
 * coordinates - goes through here, so each is checked against the service area before anything is requested.
 * A pinned point is shown straight away with its coordinates and then upgraded to a street address when the
 * reverse lookup answers (if it fails, the coordinates stay: the point is still usable).
 */
export function usePlace(area: ServiceArea, controlled?: Controlled) {
  const [internal, setInternal] = useState<Place | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const place = controlled ? controlled.value : internal
  const setPlace = controlled ? controlled.set : setInternal

  const choose = useCallback(
    (p: Place): boolean => {
      seq.current++
      if (!isValidCoordinate(p.lat, p.lon)) {
        setError('That is not a valid location.')
        return false
      }
      if (!inServiceArea(p.lat, p.lon, area.bounds)) {
        setError(area.message)
        return false
      }
      setError(null)
      setPlace({ lat: p.lat, lon: p.lon, label: p.label.trim().slice(0, 200) || coordinateLabel(p.lat, p.lon) })
      return true
    },
    [area, setPlace],
  )

  const pin = useCallback(
    async (lat: number, lon: number, knownLabel?: string): Promise<boolean> => {
      if (!choose({ lat, lon, label: knownLabel ?? coordinateLabel(lat, lon) })) return false
      if (knownLabel) return true
      const id = seq.current
      try {
        const label = await reverseGeocode(lat, lon)
        if (seq.current === id && label) setPlace({ lat, lon, label: label.slice(0, 200) })
      } catch {
        /* keep the coordinate label */
      }
      return true
    },
    [choose, setPlace],
  )

  const clear = useCallback(() => {
    seq.current++
    setError(null)
    setPlace(null)
  }, [setPlace])

  return { place, error, setError, choose, pin, clear }
}
