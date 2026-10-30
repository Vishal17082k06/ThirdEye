import { useId, useState } from 'react'
import { Button } from '../../design'
import { Input } from '../../design/Input'
import { inServiceArea, isValidCoordinate } from '../../lib/geo'
import type { ServiceArea } from './api'

interface CoordinateEntryProps {
  area: ServiceArea
  onSubmit: (lat: number, lon: number) => void
  /** Label for the submit button, e.g. "Set pickup". */
  submitLabel: string
}

/** Keyboard- and screen-reader-friendly alternative to clicking the map: type latitude and longitude. */
export function CoordinateEntry({ area, onSubmit, submitLabel }: CoordinateEntryProps) {
  const uid = useId()
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const la = Number(lat.trim())
    const lo = Number(lon.trim())
    if (lat.trim() === '' || lon.trim() === '' || !Number.isFinite(la) || !Number.isFinite(lo)) {
      setError('Enter latitude and longitude as numbers, for example 11.0168 and 76.9558.')
      return
    }
    if (!isValidCoordinate(la, lo)) {
      setError('Latitude must be between -90 and 90 and longitude between -180 and 180.')
      return
    }
    if (!inServiceArea(la, lo, area.bounds)) {
      // Coimbatore is around latitude 11, longitude 77; the reverse order is the most common typo.
      const swapped = inServiceArea(lo, la, area.bounds)
      setError(
        swapped
          ? 'Latitude and longitude look swapped. Latitude comes first: for Coimbatore it is about 11.0, longitude about 76.9.'
          : area.message,
      )
      return
    }
    setError(null)
    onSubmit(la, lo)
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate aria-label={submitLabel}>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Latitude" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="11.0168" id={`${uid}-lat`} />
        <Input label="Longitude" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="76.9558" id={`${uid}-lon`} />
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary">
        {submitLabel}
      </Button>
    </form>
  )
}
