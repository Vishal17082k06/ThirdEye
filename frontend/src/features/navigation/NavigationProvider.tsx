import { useMemo, type ReactNode } from 'react'
import {
  NavigationActionsContext,
  NavigationContext,
  NavigationSummaryContext,
  type NavigationActions,
  type NavigationSummary,
} from './navigationContext'
import { useNavigationEngine } from './useNavigation'

/**
 * Mounted once, in the Shell above the page outlet, so a trip survives page changes and anything (the voice
 * assistant, the "Navigation in progress" bar) can reach it. Commands: navigationController (setDestination,
 * setMode, start, stop, state). Three contexts keep re-renders small: full state (page), stable actions, and a
 * summary for the global bar.
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const engine = useNavigationEngine()
  const { registerPage, startNavigation, stopNavigation, setMode, toggleSimulation, chooseSimulatedStart, dismissStartFailure } = engine
  const actions = useMemo<NavigationActions>(
    () => ({ registerPage, startNavigation, stopNavigation, setMode, toggleSimulation, chooseSimulatedStart, dismissStartFailure }),
    [registerPage, startNavigation, stopNavigation, setMode, toggleSimulation, chooseSimulatedStart, dismissStartFailure],
  )
  const remaining = engine.progress?.remainingM ?? engine.route?.distance_m ?? null
  const remainingM = remaining == null ? null : Math.round(remaining / 10) * 10
  const pendingMessage = engine.startPending?.message ?? null
  const summary = useMemo<NavigationSummary>(
    () => ({
      tripActive: engine.tripActive,
      pendingMessage,
      failure: engine.startFailure,
      destinationLabel: engine.destination?.label ?? null,
      remainingM,
      simulation: engine.simulation,
    }),
    [engine.tripActive, pendingMessage, engine.startFailure, engine.destination?.label, remainingM, engine.simulation],
  )
  return (
    <NavigationActionsContext.Provider value={actions}>
      <NavigationSummaryContext.Provider value={summary}>
        <NavigationContext.Provider value={engine}>{children}</NavigationContext.Provider>
      </NavigationSummaryContext.Provider>
    </NavigationActionsContext.Provider>
  )
}
