import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FALLBACK_AREA } from './api'

// jsdom cannot draw a Leaflet map, so react-leaflet is replaced by minimal stand-ins that expose the props we care about.
const handlers: { click?: (e: { latlng: { lat: number; lng: number } }) => void } = {}
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, maxBounds, minZoom, center }: { children: ReactNode; maxBounds: unknown; minZoom: number; center: number[] }) => (
    <div data-testid="map" data-max-bounds={JSON.stringify(maxBounds)} data-min-zoom={minZoom} data-centre={center.join(',')}>
      {children}
    </div>
  ),
  TileLayer: ({ url, attribution }: { url: string; attribution: string }) => <div data-testid="tiles" data-url={url} data-attribution={attribution} />,
  Rectangle: () => <div data-testid="service-area-outline" />,
  Polyline: ({ positions }: { positions: number[][] }) => <div data-testid="route-line" data-count={positions.length} />,
  Circle: ({ radius }: { radius: number }) => <div data-testid="accuracy" data-radius={radius} />,
  Marker: ({ title }: { title: string }) => <div data-testid="marker" data-title={title} />,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), getZoom: () => 13 }),
  useMapEvents: (h: typeof handlers) => {
    handlers.click = h.click
    return null
  },
}))
vi.mock('leaflet/dist/leaflet.css', () => ({}))

import { MapView } from './MapView'

describe('MapView', () => {
  it('uses OpenStreetMap tiles with attribution, the service-area box and Coimbatore centre', () => {
    render(<MapView area={FALLBACK_AREA} />)
    const tiles = screen.getByTestId('tiles')
    expect(tiles.dataset.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(tiles.dataset.attribution).toContain('OpenStreetMap contributors')
    const map = screen.getByTestId('map')
    expect(JSON.parse(map.dataset.maxBounds!)).toEqual([[10.85, 76.85], [11.15, 77.15]])
    expect(map.dataset.minZoom).toBe('11')
    expect(map.dataset.centre).toBe('11.0168,76.9558')
    expect(screen.getByTestId('service-area-outline')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Map of Coimbatore' })).toBeInTheDocument()
  })

  it('draws labelled markers, an accuracy circle for the current location and the route', () => {
    render(
      <MapView
        area={FALLBACK_AREA}
        current={{ lat: 11.01, lon: 76.96, accuracy: 20 }}
        markers={[{ lat: 11.0, lon: 76.97, label: 'Destination: Race Course', kind: 'destination' }]}
        route={[[11.01, 76.96], [11.0, 76.97]]}
      />,
    )
    expect(screen.getAllByTestId('marker').map((m) => m.dataset.title)).toEqual(['Your current location', 'Destination: Race Course'])
    expect(screen.getByTestId('accuracy').dataset.radius).toBe('20')
    expect(screen.getAllByTestId('route-line')[0].dataset.count).toBe('2')
  })

  it('reports map clicks only when a handler is supplied and shows the hint', () => {
    const onSelect = vi.fn()
    render(<MapView area={FALLBACK_AREA} onSelect={onSelect} selecting="Click the map to set the destination" />)
    expect(screen.getByText('Click the map to set the destination')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('map'))
    handlers.click?.({ latlng: { lat: 11.02, lng: 76.97 } })
    expect(onSelect).toHaveBeenCalledWith(11.02, 76.97)
  })
})
