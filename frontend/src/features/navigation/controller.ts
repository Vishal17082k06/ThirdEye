import { useSyncExternalStore } from 'react'
import { DEFAULT_BOUNDS, inServiceArea, SERVICE_AREA_MESSAGE } from '../../lib/geo'
import type { Place, RouteMode } from '../maps/api'

/**
 * The NavigationController is a tiny shared store. The Navigation page does the work (GPS, routing, speech) and reads
 * the controller's intent; anything else - notably the later voice assistant ("Take me to ...", "Walking mode") -
 * steers navigation by calling the same four functions: setDestination, setMode, start and stop.
 *
 * `navigating` is an intent: it becomes an active trip once the page has a route. The page stops navigation when it
 * is left, because GPS and speech only run while it is open.
 */
export interface PublishedPosition {
  lat: number
  lon: number
  /** true for the simulated walk, so nothing downstream mistakes it for GPS */
  simulated: boolean
}

export interface NavigationState {
  destination: Place | null
  mode: RouteMode
  navigating: boolean
  /** The best-known current position, published by the Navigation page for "Where am I?". */
  position: PublishedPosition | null
}

export interface ActionResult {
  ok: boolean
  message?: string
}

const INITIAL: NavigationState = { destination: null, mode: 'foot', navigating: false, position: null }

export function createNavigationStore() {
  let state: NavigationState = INITIAL
  const listeners = new Set<() => void>()
  const set = (patch: Partial<NavigationState>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  return {
    getState: (): NavigationState => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Choose (or clear, with null) the destination. A place outside the Coimbatore service area is refused. */
    setDestination(place: Place | null): ActionResult {
      if (place && !inServiceArea(place.lat, place.lon, DEFAULT_BOUNDS)) return { ok: false, message: SERVICE_AREA_MESSAGE }
      set({ destination: place, ...(place === null ? { navigating: false } : {}) })
      return { ok: true }
    },
    setMode(mode: RouteMode): void {
      if (mode !== 'foot' && mode !== 'car' && mode !== 'bike') return
      set({ mode })
    },
    /** Ask to start navigating. Refused when there is no destination. */
    start(): ActionResult {
      if (!state.destination) return { ok: false, message: 'Choose a destination first.' }
      set({ navigating: true })
      return { ok: true }
    },
    stop(): void {
      if (state.navigating) set({ navigating: false })
    },
    publishPosition(position: PublishedPosition | null): void {
      const p = state.position
      if (p === position || (p && position && p.lat === position.lat && p.lon === position.lon && p.simulated === position.simulated)) return
      set({ position })
    },
    reset(): void {
      state = INITIAL
      listeners.forEach((l) => l())
    },
  }
}

export type NavigationStore = ReturnType<typeof createNavigationStore>

/** The one store the app shares. Tests call navigationController.reset() between cases. */
export const navigationController: NavigationStore = createNavigationStore()

export function useNavigationController() {
  const state = useSyncExternalStore(navigationController.subscribe, navigationController.getState, navigationController.getState)
  return {
    state,
    setDestination: navigationController.setDestination,
    setMode: navigationController.setMode,
    start: navigationController.start,
    stop: navigationController.stop,
  }
}
