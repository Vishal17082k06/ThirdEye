import { createContext, useContext } from 'react'
import type { NavigationEngine } from './useNavigation'

export const NavigationContext = createContext<NavigationEngine | null>(null)

/** The running navigation (trip, route, progress, position). Commands go through navigationController. */
export function useNavigationState(): NavigationEngine {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigationState must be used inside <NavigationProvider>')
  return ctx
}
