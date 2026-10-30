import { createContext, useContext } from 'react'
import type { NavigationEngine } from './useNavigation'

/** Everything about the running navigation. It changes on every GPS fix: only the Navigation page needs it. */
export const NavigationContext = createContext<NavigationEngine | null>(null)

/** The commands the page can issue. Stable identities, so reading them never causes a re-render. */
export interface NavigationActions {
  registerPage: NavigationEngine['registerPage']
  startNavigation: NavigationEngine['startNavigation']
  stopNavigation: NavigationEngine['stopNavigation']
  setMode: NavigationEngine['setMode']
  toggleSimulation: NavigationEngine['toggleSimulation']
  chooseSimulatedStart: NavigationEngine['chooseSimulatedStart']
  dismissStartFailure: NavigationEngine['dismissStartFailure']
}
export const NavigationActionsContext = createContext<NavigationActions | null>(null)

/** The little a global bar needs. Its identity only changes when what it shows changes. */
export interface NavigationSummary {
  tripActive: boolean
  pendingMessage: string | null
  failure: string | null
  destinationLabel: string | null
  /** metres left, rounded to 10 m so the bar does not re-render on every fix */
  remainingM: number | null
  simulation: boolean
}
export const NavigationSummaryContext = createContext<NavigationSummary | null>(null)

/** The running navigation (trip, route, progress, position). Commands go through navigationController. */
export function useNavigationState(): NavigationEngine {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigationState must be used inside <NavigationProvider>')
  return ctx
}

export function useNavigationActions(): NavigationActions {
  const ctx = useContext(NavigationActionsContext)
  if (!ctx) throw new Error('useNavigationActions must be used inside <NavigationProvider>')
  return ctx
}

export function useNavigationSummary(): NavigationSummary {
  const ctx = useContext(NavigationSummaryContext)
  if (!ctx) throw new Error('useNavigationSummary must be used inside <NavigationProvider>')
  return ctx
}
