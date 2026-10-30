import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeGeolocation } from '../test-geo'
import { describeGeoError, locateOnce, useGeolocation } from './useGeolocation'

afterEach(() => vi.unstubAllGlobals())

describe('useGeolocation', () => {
  it('watches with high accuracy and reports fixes, accuracy and the service-area check', () => {
    const geo = installFakeGeolocation()
    const { result } = renderHook(() => useGeolocation())
    expect(result.current.status).toBe('requesting')
    expect(geo.watchPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true })
    act(() => geo.emit(11.0168, 76.9558, 8))
    expect(result.current.status).toBe('active')
    expect(result.current.accuracy).toBe(8)
    expect(result.current.inArea).toBe(true)
    act(() => geo.emit(12.97, 77.59))
    expect(result.current.inArea).toBe(false)
  })

  it('stops the watch on unmount', () => {
    const geo = installFakeGeolocation()
    const { unmount } = renderHook(() => useGeolocation())
    unmount()
    expect(geo.clearWatch).toHaveBeenCalledTimes(1)
  })

  it('never touches the geolocation API when disabled', () => {
    const geo = installFakeGeolocation()
    const { result } = renderHook(() => useGeolocation(false))
    expect(geo.watchPosition).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(result.current.position).toBeNull()
  })

  it('maps permission denial and ends the watch', () => {
    const geo = installFakeGeolocation()
    const { result } = renderHook(() => useGeolocation())
    act(() => geo.fail(1))
    expect(result.current.status).toBe('denied')
    expect(result.current.message).toMatch(/permission was denied/i)
    expect(geo.clearWatch).toHaveBeenCalled()
  })

  it('reports a timeout as signal loss and recovers when a fix returns', () => {
    const geo = installFakeGeolocation()
    const { result } = renderHook(() => useGeolocation())
    act(() => geo.emit(11.0168, 76.9558))
    act(() => geo.fail(3))
    expect(result.current.status).toBe('timeout')
    expect(result.current.message).toMatch(/GPS signal lost/)
    act(() => geo.emit(11.017, 76.956))
    expect(result.current.status).toBe('active')
  })

  it('is honest when the browser has no geolocation', () => {
    vi.stubGlobal('navigator', {})
    const { result } = renderHook(() => useGeolocation())
    expect(result.current.status).toBe('unavailable')
    expect(result.current.message).toMatch(/GPS not available/)
  })

  it('describes error codes', () => {
    expect(describeGeoError(1).status).toBe('denied')
    expect(describeGeoError(2).status).toBe('unavailable')
    expect(describeGeoError(3).status).toBe('timeout')
    expect(describeGeoError(undefined).message).toMatch(/GPS not available/)
  })

  it('locateOnce resolves a fix and rejects with a readable failure', async () => {
    const geo = installFakeGeolocation()
    geo.getCurrentPosition.mockImplementationOnce((ok: PositionCallback) =>
      ok({ coords: { latitude: 11, longitude: 76.9, accuracy: 5 }, timestamp: 1 } as GeolocationPosition),
    )
    await expect(locateOnce()).resolves.toMatchObject({ lat: 11, lon: 76.9, accuracy: 5 })
    geo.getCurrentPosition.mockImplementationOnce((_ok: PositionCallback, err: PositionErrorCallback) => err({ code: 1 } as GeolocationPositionError))
    await expect(locateOnce()).rejects.toMatchObject({ status: 'denied' })
  })
})
