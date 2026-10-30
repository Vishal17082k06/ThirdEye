import L from 'leaflet'
import { LocateFixed } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
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
  /** Navigation is under way: keep the current position in view until the person drags the map. */
  follow?: boolean
  className?: string
  ariaLabel?: string
}

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
export const MIN_ZOOM = 11

function ClickHandler({ onSelect }: { onSelect?: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onSelect?.(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

/**
 * Fits the map to a route when a NEW route arrives, and only then: not when following starts or stops, not after a
 * drag, not when a trip ends. A route that arrives while the map is following the person is not fitted (and is not
 * fitted later either).
 */
function FitRoute({ route, suppress }: { route?: LatLngTuple[]; suppress: boolean }) {
  const map = useMap()
  const seen = useRef<LatLngTuple[] | undefined>(undefined)
  const suppressRef = useRef(suppress)
  suppressRef.current = suppress
  useEffect(() => {
    if (route === seen.current) return
    seen.current = route
    if (suppressRef.current || !route || route.length < 2) return
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

/** The map's size changes with the layout (sidebar collapse, rotation); Leaflet must be told. */
function ResizeWatcher() {
  const map = useMap()
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

/** Follow mode: pan to the current position as it changes. A manual drag pauses it (reported through onUserDrag). */
function FollowCurrent({ current, active, onUserDrag }: { current?: CurrentPoint | null; active: boolean; onUserDrag: () => void }) {
  const map = useMap()
  useMapEvents({ dragstart: onUserDrag })
  const zoomed = useRef(false)
  useEffect(() => {
    if (!active || !current) return
    if (!zoomed.current) {
      zoomed.current = true
      map.setView([current.lat, current.lon], Math.max(map.getZoom(), 16))
    } else {
      map.panTo([current.lat, current.lon])
    }
  }, [active, current, map])
  return null
}

/**
 * OpenStreetMap map limited to the service area. A map is not usable with a screen reader or without a pointer, so
 * every page that shows one also offers search, "use my location" and typed coordinates, plus a text status line.
 */
export function MapView({ area, current, markers = [], route, onSelect, selecting, follow = false, className, ariaLabel = 'Map of Coimbatore' }: MapViewProps) {
  const [paused, setPaused] = useState(false)
  // A new trip starts in follow mode again.
  const [prevFollow, setPrevFollow] = useState(follow)
  if (prevFollow !== follow) {
    setPrevFollow(follow)
    if (follow) setPaused(false)
  }
  const following = follow && !paused
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
          <ResizeWatcher />
          <FitRoute route={route} suppress={following} />
          <FollowCurrent current={current} active={following} onUserDrag={() => setPaused(true)} />
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
      {follow && paused && (
        <button
          type="button"
          onClick={() => setPaused(false)}
          className="bw absolute bottom-8 right-3 z-[1000] inline-flex min-h-[var(--control-h)] items-center gap-2 rounded-xl border-line-strong bg-surface px-4 py-2 font-semibold text-ink shadow-pop hover:bg-surface-muted"
        >
          <LocateFixed className="h-5 w-5" aria-hidden="true" />
          Re-centre
        </button>
      )}
      {selecting && (
        <p className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-[80%] rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-surface shadow-pop">
          {selecting}
        </p>
      )}
    </div>
  )
}
