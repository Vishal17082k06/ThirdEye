import type { MapViewProps } from './features/maps/MapView'

/**
 * Stand-in for the Leaflet MapView in page tests (jsdom cannot draw a map). It exposes what the page passed in
 * and offers buttons that behave like clicking particular spots on the map.
 */
export const SPOTS = {
  gandhipuram: { name: 'Gandhipuram', lat: 11.0183, lon: 76.9725 },
  raceCourse: { name: 'Race Course', lat: 11.001, lon: 76.966 },
  outside: { name: 'Bengaluru', lat: 12.9716, lon: 77.5946 },
} as const

export function MapView(props: MapViewProps) {
  return (
    <div data-testid="map" data-route-points={props.route?.length ?? 0}>
      {props.markers?.map((m) => (
        <span key={m.kind} data-testid={`marker-${m.kind}`}>
          {m.label}
        </span>
      ))}
      {props.current && (
        <span data-testid="current-marker" data-lat={props.current.lat} data-lon={props.current.lon}>
          {props.current.label}
        </span>
      )}
      {props.selecting && <p>{props.selecting}</p>}
      {props.onSelect &&
        Object.values(SPOTS).map((s) => (
          <button key={s.name} type="button" onClick={() => props.onSelect?.(s.lat, s.lon)}>
            {`map click: ${s.name}`}
          </button>
        ))}
    </div>
  )
}
