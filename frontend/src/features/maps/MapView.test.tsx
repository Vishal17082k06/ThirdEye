import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_AREA } from './api'

// jsdom cannot draw a Leaflet map, so react-leaflet is replaced by minimal stand-ins that expose the props we care about.
const m = vi.hoisted(() => ({
  handlers: {} as Record<string, (e?: unknown) => void>,
  map: {
    fitBounds: vi.fn(),
    setView: vi.fn(),
    panTo: vi.fn(),
    invalidateSize: vi.fn(),
    getZoom: () => 13,
    getContainer: () => document.body,
  },
}))
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
  useMap: () => m.map,
  useMapEvents: (h: Record<string, (e?: unknown) => void>) => {
    Object.assign(m.handlers, h)
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
    expect(tiles.dataset.attribution).toContain('href="https://www.openstreetmap.org/copyright"')
    expect(tiles.dataset.attribution).toContain('rel="noopener noreferrer"')
    expect(tiles.dataset.attribution).toContain('OpenStreetMap</a> contributors')
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
    m.handlers.click?.({ latlng: { lat: 11.02, lng: 76.97 } })
    expect(onSelect).toHaveBeenCalledWith(11.02, 76.97)
  })

  describe('resize and follow mode', () => {
    let resizeCallback: (() => void) | null = null
    const disconnect = vi.fn()
    beforeEach(() => {
      Object.values(m.map).forEach((f) => typeof f === 'function' && 'mockClear' in f && (f as ReturnType<typeof vi.fn>).mockClear())
      resizeCallback = null
      disconnect.mockClear()
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: () => void) {
            resizeCallback = cb
          }
          observe() {}
          disconnect = disconnect
        },
      )
    })
    afterEach(() => vi.unstubAllGlobals())

    it('tells Leaflet when its container is resized, and stops observing on unmount', () => {
      const { unmount } = render(<MapView area={FALLBACK_AREA} />)
      expect(m.map.invalidateSize).not.toHaveBeenCalled()
      act(() => resizeCallback?.())
      expect(m.map.invalidateSize).toHaveBeenCalledTimes(1)
      unmount()
      expect(disconnect).toHaveBeenCalled()
    })

    const at = (lat: number) => ({ lat, lon: 76.96, accuracy: 10 })
    const route: Array<[number, number]> = [
      [11.0, 76.96],
      [11.01, 76.96],
    ]

    it('without follow mode a new route is fitted and the map does not chase the position', () => {
      const { rerender } = render(<MapView area={FALLBACK_AREA} route={route} current={at(11.0)} />)
      expect(m.map.fitBounds).toHaveBeenCalledTimes(1)
      rerender(<MapView area={FALLBACK_AREA} route={[...route]} current={at(11.005)} />)
      expect(m.map.fitBounds).toHaveBeenCalledTimes(2)
      expect(m.map.panTo).not.toHaveBeenCalled()
    })

    it('in follow mode it pans to each new position and does not re-fit when the route changes', () => {
      const { rerender } = render(<MapView area={FALLBACK_AREA} route={route} current={at(11.0)} follow />)
      expect(m.map.fitBounds).not.toHaveBeenCalled()
      expect(m.map.setView).toHaveBeenCalled() // first fix: zoom in on the person
      rerender(<MapView area={FALLBACK_AREA} route={[...route]} current={at(11.004)} follow />)
      expect(m.map.panTo).toHaveBeenCalledWith([11.004, 76.96])
      expect(m.map.fitBounds).not.toHaveBeenCalled()
    })

    it('a manual drag pauses following and shows Re-centre, which resumes it', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<MapView area={FALLBACK_AREA} route={route} current={at(11.0)} follow />)
      expect(screen.queryByRole('button', { name: 'Re-centre' })).not.toBeInTheDocument()
      act(() => m.handlers.dragstart?.())
      expect(screen.getByRole('button', { name: 'Re-centre' })).toBeInTheDocument()
      m.map.panTo.mockClear()
      rerender(<MapView area={FALLBACK_AREA} route={route} current={at(11.006)} follow />)
      expect(m.map.panTo).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Re-centre' }))
      expect(m.map.panTo).toHaveBeenCalledWith([11.006, 76.96])
      expect(screen.queryByRole('button', { name: 'Re-centre' })).not.toBeInTheDocument()
    })
  })
})
