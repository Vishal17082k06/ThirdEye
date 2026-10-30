import { Crosshair, LocateFixed, MapPinned, Keyboard } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Button } from '../../design'
import type { Place, ServiceArea } from './api'
import { CoordinateEntry } from './CoordinateEntry'
import { PlaceSearch } from './PlaceSearch'
import type { usePlace } from './usePlace'

interface LocationFieldProps {
  /** "Pickup", "Destination", "Starting point" */
  label: string
  area: ServiceArea
  state: ReturnType<typeof usePlace>
  /** Whether a map click currently sets this field. */
  picking: boolean
  onTogglePick: () => void
  /** Optional "use my location" style action. */
  useCurrent?: { label: string; onClick: () => void; busy?: boolean; disabled?: boolean }
  extra?: ReactNode
}

/**
 * One location input with every way to fill it: search, "use my location", click the map, or type coordinates.
 * The map is never the only way, because maps are not usable with a keyboard-only or screen-reader workflow.
 */
export function LocationField({ label, area, state, picking, onTogglePick, useCurrent, extra }: LocationFieldProps) {
  const uid = useId()
  const [coords, setCoords] = useState(false)
  const { place, error } = state

  return (
    <div className="space-y-3">
      <PlaceSearch
        label={label}
        value={place}
        onSelect={(p: Place) => state.choose(p)}
        onEdit={() => state.clear()}
      />
      <div className="flex flex-wrap gap-2">
        {useCurrent && (
          <Button
            variant="secondary"
            onClick={useCurrent.onClick}
            loading={useCurrent.busy}
            disabled={useCurrent.disabled}
            leftIcon={<LocateFixed className="h-5 w-5" aria-hidden="true" />}
          >
            {useCurrent.label}
          </Button>
        )}
        <Button
          variant={picking ? 'primary' : 'secondary'}
          onClick={onTogglePick}
          aria-pressed={picking}
          leftIcon={<Crosshair className="h-5 w-5" aria-hidden="true" />}
        >
          {picking ? 'Cancel choosing on map' : `Choose ${label.toLowerCase()} on map`}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setCoords((c) => !c)}
          aria-expanded={coords}
          aria-controls={`${uid}-coords`}
          leftIcon={<Keyboard className="h-5 w-5" aria-hidden="true" />}
        >
          Enter coordinates
        </Button>
      </div>
      {coords && (
        <div id={`${uid}-coords`} className="bw rounded-xl border-line bg-surface-muted p-3">
          <CoordinateEntry
            area={area}
            submitLabel={`Set ${label.toLowerCase()} from coordinates`}
            onSubmit={(lat, lon) => {
              void state.pin(lat, lon)
              setCoords(false)
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="bw rounded-xl border-danger bg-danger-soft p-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      {place && !error && (
        <p className="flex items-start gap-2 text-sm text-muted">
          <MapPinned className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {label} set to <span className="font-semibold text-ink">{place.label}</span>
          </span>
        </p>
      )}
      {extra}
    </div>
  )
}
