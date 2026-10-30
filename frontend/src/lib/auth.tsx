import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, setUnauthorizedHandler } from './api'
import { clearToken, getToken, setToken } from './token'

export interface User {
  id: number
  name: string
  email: string
  phone: string
}

interface AuthResponse {
  token: string
  user: User
}

export interface RegisterInput {
  name: string
  email: string
  phone: string
  password: string
}

type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  user: User | null
  status: AuthStatus
  login: (email: string, password: string, remember: boolean) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => void
  /** Reflect a saved profile change in the signed-in user without another round trip. */
  updateUser: (patch: Partial<User>) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  children,
  initialUser,
}: {
  children: ReactNode
  /** Test hook: start in a known state without calling /auth/me. */
  initialUser?: User | null
}) {
  const hasInitial = initialUser !== undefined
  const [user, setUser] = useState<User | null>(initialUser ?? null)
  const [status, setStatus] = useState<AuthStatus>(
    hasInitial ? (initialUser ? 'authenticated' : 'anonymous') : getToken() ? 'loading' : 'anonymous',
  )

  // On start, trade a stored token for the current user.
  useEffect(() => {
    if (hasInitial || !getToken()) return
    let cancelled = false
    api
      .get<User>('/auth/me')
      .then((u) => {
        if (cancelled) return
        setUser(u)
        setStatus('authenticated')
      })
      .catch((err) => {
        if (cancelled) return
        // Only a rejected token means "signed out". A network error keeps the token for the next try.
        if (err instanceof ApiError && err.status === 401) clearToken()
        setUser(null)
        setStatus('anonymous')
      })
    return () => {
      cancelled = true
    }
  }, [hasInitial])

  const accept = useCallback((res: AuthResponse, remember: boolean) => {
    setToken(res.token, remember)
    setUser(res.user)
    setStatus('authenticated')
  }, [])

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const res = await api.post<AuthResponse>('/auth/login', { email, password, remember })
      accept(res, remember)
    },
    [accept],
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await api.post<AuthResponse>('/auth/register', input)
      accept(res, false)
    },
    [accept],
  )

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setStatus('anonymous')
  }, [])

  const updateUser = useCallback((patch: Partial<User>) => setUser((u) => (u ? { ...u, ...patch } : u)), [])

  // An expired or revoked token on any later request signs the user out; ProtectedRoute then redirects to /login.
  useEffect(() => {
    setUnauthorizedHandler(logout)
    return () => setUnauthorizedHandler(null)
  }, [logout])

  const value = useMemo(
    () => ({ user, status, login, register, logout, updateUser }),
    [user, status, login, register, logout, updateUser],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
