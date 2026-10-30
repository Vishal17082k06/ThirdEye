import { describe, expect, it } from 'vitest'
import {
  arrivalClock,
  DEFAULT_BOUNDS,
  formatDistance,
  formatDuration,
  haversineM,
  inServiceArea,
  isValidCoordinate,
} from './geo'

describe('inServiceArea', () => {
  it('accepts central Coimbatore', () => {
    expect(inServiceArea(11.0168, 76.9558)).toBe(true)
  })
  it('includes all four edges and corners', () => {
    const { south, west, north, east } = DEFAULT_BOUNDS
    expect(inServiceArea(south, 76.95)).toBe(true)
    expect(inServiceArea(north, 76.95)).toBe(true)
    expect(inServiceArea(11, west)).toBe(true)
    expect(inServiceArea(11, east)).toBe(true)
    expect(inServiceArea(south, west)).toBe(true)
    expect(inServiceArea(north, east)).toBe(true)
  })
  it('rejects points just outside each edge', () => {
    expect(inServiceArea(10.849, 76.95)).toBe(false)
    expect(inServiceArea(11.151, 76.95)).toBe(false)
    expect(inServiceArea(11, 76.849)).toBe(false)
    expect(inServiceArea(11, 77.151)).toBe(false)
  })
  it('rejects NaN, Infinity and non-numbers', () => {
    expect(inServiceArea(NaN, 76.95)).toBe(false)
    expect(inServiceArea(11, NaN)).toBe(false)
    expect(inServiceArea(Infinity, 76.95)).toBe(false)
    expect(inServiceArea('11' as unknown as number, 76.95)).toBe(false)
  })
  it('rejects swapped latitude and longitude', () => {
    expect(inServiceArea(76.9558, 11.0168)).toBe(false)
  })
  it('rejects other cities', () => {
    expect(inServiceArea(12.9716, 77.5946)).toBe(false)
  })
  it('honours custom bounds', () => {
    expect(inServiceArea(1, 1, { south: 0, west: 0, north: 2, east: 2 })).toBe(true)
  })
})

describe('isValidCoordinate', () => {
  it('rejects values off the globe', () => {
    expect(isValidCoordinate(91, 0)).toBe(false)
    expect(isValidCoordinate(0, 181)).toBe(false)
    expect(isValidCoordinate(0, 0)).toBe(true)
  })
})

describe('haversineM', () => {
  it('is zero for the same point', () => {
    expect(haversineM({ lat: 11, lon: 77 }, { lat: 11, lon: 77 })).toBe(0)
  })
  it('measures one degree of latitude as about 111 km', () => {
    expect(haversineM({ lat: 11, lon: 77 }, { lat: 12, lon: 77 })).toBeCloseTo(111_195, -2)
  })
  it('measures Gandhipuram to Race Course as a few kilometres', () => {
    const d = haversineM({ lat: 11.0183, lon: 76.9725 }, { lat: 11.001, lon: 76.966 })
    expect(d).toBeGreaterThan(1800)
    expect(d).toBeLessThan(2300)
  })
})

describe('formatting', () => {
  it('formats distance in m and km', () => {
    expect(formatDistance(850)).toBe('850 m')
    expect(formatDistance(1234)).toBe('1.2 km')
    expect(formatDistance(12_400)).toBe('12 km')
    expect(formatDistance(NaN)).toBe('—')
  })
  it('formats durations', () => {
    expect(formatDuration(30)).toBe('30 sec')
    expect(formatDuration(600)).toBe('10 min')
    expect(formatDuration(3900)).toBe('1 h 5 min')
    expect(formatDuration(7200)).toBe('2 h')
  })
  it('computes an arrival clock time from a start time', () => {
    const from = new Date(2026, 0, 1, 10, 0, 0)
    const text = arrivalClock(1800, from)
    expect(text).toBe(new Date(2026, 0, 1, 10, 30, 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  })
})
