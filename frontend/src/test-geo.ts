import { vi } from 'vitest'

export interface FakeGeo {
  watchPosition: ReturnType<typeof vi.fn>
  clearWatch: ReturnType<typeof vi.fn>
  getCurrentPosition: ReturnType<typeof vi.fn>
  /** Deliver a fix to every active watcher. */
  emit: (lat: number, lon: number, accuracy?: number) => void
  /** Deliver an error (1 denied, 2 unavailable, 3 timeout). */
  fail: (code: number) => void
}

/** Installs a controllable navigator.geolocation. Remove it with vi.unstubAllGlobals(). */
export function installFakeGeolocation(): FakeGeo {
  const watchers = new Map<number, { ok: PositionCallback; err?: PositionErrorCallback }>()
  let next = 1
  const watchPosition = vi.fn((ok: PositionCallback, err?: PositionErrorCallback | null) => {
    const id = next++
    watchers.set(id, { ok, err: err ?? undefined })
    return id
  })
  const clearWatch = vi.fn((id: number) => {
    watchers.delete(id)
  })
  const getCurrentPosition = vi.fn()
  const geo = {
    watchPosition,
    clearWatch,
    getCurrentPosition,
    emit(lat: number, lon: number, accuracy = 12) {
      const pos = { coords: { latitude: lat, longitude: lon, accuracy }, timestamp: Date.now() } as GeolocationPosition
      for (const w of [...watchers.values()]) w.ok(pos)
    },
    fail(code: number) {
      for (const w of [...watchers.values()]) w.err?.({ code } as GeolocationPositionError)
    },
  }
  vi.stubGlobal('navigator', { ...navigator, geolocation: geo })
  return geo
}
