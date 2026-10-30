import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from './design'
import { AuthProvider, type User } from './lib/auth'
import { ModeProvider, type Mode } from './lib/mode'

export const TEST_USER: User = { id: 1, name: 'Asha Raman', email: 'asha@example.com', phone: '+919876543210' }

interface Options {
  route?: string | { pathname: string; state?: unknown }
  user?: User | null
  mode?: Mode | null
  /** Use the real AuthProvider startup (token -> /auth/me) instead of a preset user. */
  realAuth?: boolean
}

/** Renders with the same providers as the real app, but with a known user/mode and an in-memory router. */
export function renderApp(ui: ReactElement, { route = '/', user = TEST_USER, mode = null, realAuth = false }: Options = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <AuthProvider initialUser={realAuth ? undefined : user}>
            <ModeProvider initialMode={mode}>{ui}</ModeProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
