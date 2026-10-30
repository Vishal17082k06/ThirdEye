import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { Circle, MapContainer, Marker, Polyline, Rectangle, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { cn } from '../../lib/cn'
import type { ServiceArea } from './api'
import { pinIcon } from './icons'
import type { LatLngTuple } from './polyline'

export interface MapMarker {
  lat: number
  lon: number
  /** Spoken/accessible name, e.g. "Pickup: Gandhipuram". */
  label: string
  kind: 'pickup' | 'destination' | 'start'
}

export interface CurrentPoint {
  lat: number
  lon: number
  accuracy: number | null
  label?: string
}

export interface MapViewProps {
  area: ServiceArea
  current?: CurrentPoint | null
  markers?: MapMarker[]
  /** Already in [lat, lon] order (see geoJsonToLatLng). */
  route?: LatLngTuple[]
  /** When set, a click on the map reports its position. */
  onSelect?: (lat: number, lon: number) => void
  /** Shown as a hint chip while a click is expected, e.g. "Click the map to set the destination". */
  selecting?: string | null
  className?: string
  ariaLabel?: string
}

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors'
export const MIN_ZOOM = 11

function ClickHandler({ onSelect }: { onSelect?: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onSelect?.(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

/** Keeps the whole route in view whenever a new one arrives. */
function FitRoute({ route }: { route?: LatLngTuple[] }) {
  const map = useMap()
  useEffect(() => {
    if (!route || route.length < 2) return
    map.fitBounds(L.latLngBounds(route), { padding: [40, 40], maxZoom: 17 })
  }, [route, map])
  return null
}

/** Moves to the first position fix (only if no route is shown) so the user's own location is what they see. */
function FocusCurrent({ current, hasRoute }: { current?: CurrentPoint | null; hasRoute: boolean }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (!current || hasRoute || done.current) return
    done.current = true
    map.setView([current.lat, current.lon], Math.max(map.getZoom(), 15))
  }, [current, hasRoute, map])
  return null
}

/**
 * OpenStreetMap map limited to the service area. A map is not usable with a screen reader or without a pointer, so
 * every page that shows one also offers search, "use my location" and typed coordinates, plus a text status line.
 */
export function MapView({ area, current, markers = [], route, onSelect, selecting, className, ariaLabel = 'Map of Coimbatore' }: MapViewProps) {
  const { south, west, north, east } = area.bounds
  const bounds: L.LatLngBoundsExpression = [
    [south, west],
    [north, east],
  ]
  return (
    <div className={cn('relative isolate overflow-hidden rounded-2xl border border-line', selecting && 'te-picking', className)}>
      <div role="region" aria-label={ariaLabel} className="h-full w-full">
        <MapContainer
          center={[area.centre.lat, area.centre.lon]}
          zoom={13}
          minZoom={MIN_ZOOM}
          maxBounds={bounds}
          maxBoundsViscosity={1}
          className="h-full w-full"
          scrollWheelZoom
        >
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
          <Rectangle bounds={bounds} interactive={false} pathOptions={{ color: '#0f766e', weight: 2, dashArray: '6 6', fill: false }} />
          <ClickHandler onSelect={onSelect} />
          <FitRoute route={route} />
          <FocusCurrent current={current} hasRoute={!!route && route.length > 1} />
          {route && route.length > 1 && (
            <>
              <Polyline positions={route} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} interactive={false} />
              <Polyline positions={route} pathOptions={{ color: '#1d4ed8', weight: 5 }} interactive={false} />
            </>
          )}
          {current && (
            <>
              {current.accuracy != null && current.accuracy > 0 && (
                <Circle
                  center={[current.lat, current.lon]}
                  radius={current.accuracy}
                  interactive={false}
                  pathOptions={{ color: '#1d4ed8', weight: 1, fillOpacity: 0.12 }}
                />
              )}
              <Marker
                position={[current.lat, current.lon]}
                icon={pinIcon('current', current.label ?? 'Your current location')}
                title={current.label ?? 'Your current location'}
                zIndexOffset={500}
              />
            </>
          )}
          {markers.map((m) => (
            <Marker key={`${m.kind}-${m.lat}-${m.lon}`} position={[m.lat, m.lon]} icon={pinIcon(m.kind, m.label)} title={m.label} />
          ))}
        </MapContainer>
      </div>
      {selecting && (
        <p className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-[80%] rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-surface shadow-pop">
          {selecting}
        </p>
      )}
    </div>
  )
}
