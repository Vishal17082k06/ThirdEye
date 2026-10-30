import type { LatLon } from '../../lib/geo'

/** GeoJSON stores positions as [longitude, latitude]; Leaflet wants [latitude, longitude]. */
export type LatLngTuple = [number, number]

export function geoJsonToLatLng(coordinates: ReadonlyArray<ReadonlyArray<number>>): LatLngTuple[] {
  const out: LatLngTuple[] = []
  for (const c of coordinates) {
    if (!Array.isArray(c) || c.length < 2) continue
    const [lon, lat] = c
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    out.push([lat, lon])
  }
  return out
}

export function tupleToPoint([lat, lon]: LatLngTuple): LatLon {
  return { lat, lon }
}
