import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Login } from '../features/auth/Login'
import { Modal } from '../design'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { clearToken, getToken, setToken } from '../lib/token'
import { renderApp } from '../test-utils'
import { ProtectedRoute, PublicOnlyRoute } from './ProtectedRoute'
import { Shell } from './Shell'

afterEach(() => {
  vi.unstubAllGlobals()
  clearToken()
  sessionStorage.clear()
})

const USER = { id: 1, name: 'Asha Raman', email: 'asha@example.com', phone: '+919876543210' }

describe('session handling', () => {
  it('shows a loading spinner while /auth/me is pending', () => {
    setToken('tok', false)
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderApp(
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<p>secret</p>} />
        </Route>
        <Route path="/login" element={<p>login page</p>} />
      </Routes>,
      { realAuth: true },
    )
    expect(screen.getByText('Checking your session')).toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('a 401 from /auth/me at startup clears the token and redirects to /login', async () => {
    setToken('stale', true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Invalid token' }), { status: 401 })))
    renderApp(
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<p>secret</p>} />
        </Route>
        <Route path="/login" element={<p>login page</p>} />
      </Routes>,
      { realAuth: true },
    )
    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(getToken()).toBeNull()
  })

  it('a 401 on any later request signs the user out and ProtectedRoute redirects to /login', async () => {
    setToken('tok', false)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Token expired' }), { status: 401 })))
    function Page() {
      useAuth()
      return <button onClick={() => api.get('/profile').catch(() => {})}>load profile</button>
    }
    renderApp(
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Page />} />
        </Route>
        <Route path="/login" element={<p>login page</p>} />
      </Routes>,
      { user: USER },
    )
    await userEvent.click(screen.getByRole('button', { name: 'load profile' }))
    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(getToken()).toBeNull()
  })

  it('PublicOnlyRoute redirects authenticated users to /portal', () => {
    renderApp(
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<p>login page</p>} />
        </Route>
        <Route path="/portal" element={<p>portal page</p>} />
      </Routes>,
      { route: '/login', user: USER },
    )
    expect(screen.getByText('portal page')).toBeInTheDocument()
  })

  it('Login returns to the page the user was sent from', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 't', user: USER }), { status: 200 })))
    renderApp(
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
        </Route>
        <Route path="/dashboard" element={<p>dashboard page</p>} />
        <Route path="/portal" element={<p>portal page</p>} />
      </Routes>,
      { route: { pathname: '/login', state: { from: '/dashboard' } }, user: null },
    )
    await userEvent.type(screen.getByLabelText('Email'), 'asha@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'goodpass1')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByText('dashboard page')).toBeInTheDocument()
  })
})

function ShellHarness({ route = '/dashboard' }: { route?: string }) {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/dashboard" element={<Link to="/settings">go to settings</Link>} />
        <Route path="/settings" element={<p>settings page</p>} />
      </Route>
      <Route path="*" element={<p>{route}</p>} />
    </Routes>
  )
}

describe('Shell focus management', () => {
  it('does not steal focus on first mount (skip link stays first in tab order)', () => {
    renderApp(<ShellHarness />, { route: '/dashboard', mode: 'live' })
    expect(document.activeElement).toBe(document.body)
    expect(document.activeElement).not.toBe(document.getElementById('main'))
  })

  it('moves focus to main after navigating', async () => {
    renderApp(<ShellHarness />, { route: '/dashboard', mode: 'live' })
    await userEvent.click(screen.getByRole('link', { name: 'go to settings' }))
    expect(await screen.findByText('settings page')).toBeInTheDocument()
    expect(document.activeElement).toBe(document.getElementById('main'))
  })
})

describe('mobile drawer', () => {
  it('focuses the first nav link, makes the page inert, closes on Esc and returns focus to the menu button', async () => {
    renderApp(<ShellHarness />, { route: '/dashboard', mode: 'live' })
    const menu = screen.getByRole('button', { name: 'Open navigation menu' })
    await userEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveFocus()
    expect(document.getElementById('main')!.parentElement).toHaveAttribute('inert')

    await userEvent.keyboard('{Escape}')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('main')!.parentElement).not.toHaveAttribute('inert')
    expect(menu).toHaveFocus()
  })

  it('following a link closes the drawer and focus lands on the new page, not the menu button', async () => {
    renderApp(<ShellHarness />, { route: '/dashboard', mode: 'live' })
    const menu = screen.getByRole('button', { name: 'Open navigation menu' })
    await userEvent.click(menu)
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByText('settings page')).toBeInTheDocument()
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(document.getElementById('main'))
  })

  it('Esc closes only the topmost layer when a modal is open above other layers', async () => {
    const onClose = vi.fn()
    renderApp(
      <>
        <ShellHarness />
        <Modal open onClose={onClose} title="Confirm" />
      </>,
      { route: '/dashboard', mode: 'live' },
    )
    await act(async () => {})
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
