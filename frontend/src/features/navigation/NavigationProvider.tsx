import type { ReactNode } from 'react'
import { NavigationContext } from './navigationContext'
import { useNavigationEngine } from './useNavigation'

/**
 * Mounted once, in the Shell above the page outlet, so a trip survives page changes and anything (the voice
 * assistant, the "Navigation in progress" bar) can reach it. Commands: navigationController (setDestination,
 * setMode, start, stop, state).
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const engine = useNavigationEngine()
  return <NavigationContext.Provider value={engine}>{children}</NavigationContext.Provider>
}
