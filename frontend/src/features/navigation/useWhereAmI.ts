import { useCallback } from 'react'
import { locateOnce, type GeoFailure } from '../../hooks/useGeolocation'
import { useSpeech } from '../../hooks/useSpeech'
import { ApiError } from '../../lib/api'
import { inServiceArea, SERVICE_AREA_MESSAGE, type LatLon } from '../../lib/geo'
import { useMode } from '../../lib/mode'
import { navErrorMessage, reverseGeocode } from '../maps/api'
import { navigationController } from './controller'

/**
 * "Where am I?" - reverse-geocodes the current position, speaks the answer and returns it as text.
 * The text is also what the later voice assistant will read out. The position is the Navigation page's current
 * one when there is one (real GPS in Live mode, the simulated/manual position in Simulation mode); otherwise Live
 * mode asks the device once. Simulation mode never uses real GPS.
 */
export function useWhereAmI() {
  const { mode } = useMode()
  const { speak } = useSpeech()

  const ask = useCallback(async (): Promise<string> => {
    const say = (text: string): string => {
      speak(text, { interrupt: true })
      return text
    }

    let pos: LatLon | null = navigationController.getState().position
    if (!pos) {
      if (mode === 'simulation') {
        return say('No location is set. Choose a starting point on the Navigation page. Simulation mode does not use real GPS.')
      }
      try {
        pos = await locateOnce()
      } catch (err) {
        return say((err as GeoFailure).message ?? 'GPS not available.')
      }
    }
    if (!inServiceArea(pos.lat, pos.lon)) {
      return say(`You appear to be outside the Coimbatore service area, so I cannot describe where you are. ${SERVICE_AREA_MESSAGE}`)
    }
    try {
      const label = await reverseGeocode(pos.lat, pos.lon)
      return say(`You are near ${label}.`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return say('I could not find an address for this location.')
      return say(navErrorMessage(err, 'address'))
    }
  }, [mode, speak])

  return { ask }
}
