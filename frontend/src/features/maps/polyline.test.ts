import { describe, expect, it } from 'vitest'
import { geoJsonToLatLng } from './polyline'

describe('geoJsonToLatLng', () => {
  it('swaps [lon, lat] into [lat, lon]', () => {
    expect(geoJsonToLatLng([[76.9725, 11.0183], [76.966, 11.001]])).toEqual([[11.0183, 76.9725], [11.001, 76.966]])
  })
  it('drops malformed and non-finite positions instead of drawing garbage', () => {
    expect(geoJsonToLatLng([[76.9, 11], [NaN, 11], [76.9], [76.8, 11.1]])).toEqual([[11, 76.9], [11.1, 76.8]])
  })
  it('returns an empty list for no coordinates', () => {
    expect(geoJsonToLatLng([])).toEqual([])
  })
})
