import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Mode = 'simulation' | 'live'

interface ModeContextValue {
  /** null until the user has picked a portal. */
  mode: Mode | null
  setMode: (mode: Mode | null) => void
}

const ModeContext = createContext<ModeContextValue | null>(null)
const KEY = 'thirdeye.mode'

function readMode(): Mode | null {
  try {
    const v = sessionStorage.getItem(KEY)
    return v === 'simulation' || v === 'live' ? v : null
  } catch {
    return null
  }
}

export function ModeProvider({ children, initialMode }: { children: ReactNode; initialMode?: Mode | null }) {
  const [mode, setModeState] = useState<Mode | null>(initialMode !== undefined ? initialMode : readMode)

  const setMode = useCallback((next: Mode | null) => {
    setModeState(next)
    try {
      if (next) sessionStorage.setItem(KEY, next)
      else sessionStorage.removeItem(KEY)
    } catch {
      /* storage unavailable: mode lives in memory only */
    }
  }, [])

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode])
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used inside <ModeProvider>')
  return ctx
}
