import type { GeoFix, GeoStatus } from '../../hooks/useGeolocation'

/** The one honest sentence about location, shared by the page and the confirmation dialog. */
export function locationText(status: GeoStatus, position: GeoFix | null): string {
  if (position) {
    return position.accuracy != null ? `Location ready (±${Math.round(position.accuracy)} m)` : 'Location ready'
  }
  if (status === 'denied' || status === 'unavailable') {
    return 'Location unavailable — the alert will say location could not be obtained'
  }
  return 'Getting location…'
}
