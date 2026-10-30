import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearToken } from '../../lib/token'
import { renderApp } from '../../test-utils'
import { ForgotPassword } from './ForgotPassword'
import { Login } from './Login'
import { Register } from './Register'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearToken()
})

describe('Login', () => {
  it('validates empty fields without calling the server', async () => {
    const fetchFn = mockFetch(200, {})
    renderApp(<Login />, { user: null })
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('rejects a malformed email', async () => {
    renderApp(<Login />, { user: null })
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.type(screen.getByLabelText('Password'), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument()
  })

  it('toggles password visibility', async () => {
    renderApp(<Login />, { user: null })
    const field = screen.getByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(field).toHaveAttribute('type', 'text')
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(field).toHaveAttribute('type', 'password')
  })

  it('shows the server error banner on a failed login', async () => {
    mockFetch(401, { detail: 'Invalid email or password' })
    renderApp(<Login />, { user: null })
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass1')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
  })

  it('stores the token in sessionStorage unless Remember me is ticked', async () => {
    mockFetch(200, { token: 'tok-1', user: { id: 1, name: 'A', email: 'a@b.co', phone: '1234567' } })
    renderApp(
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/portal" element={<p>portal page</p>} />
      </Routes>,
      { user: null },
    )
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    await screen.findByText('portal page')
    expect(sessionStorage.getItem('thirdeye.token')).toBe('tok-1')
    expect(localStorage.getItem('thirdeye.token')).toBeNull()
  })

  it('uses localStorage when Remember me is ticked', async () => {
    mockFetch(200, { token: 'tok-2', user: { id: 1, name: 'A', email: 'a@b.co', phone: '1234567' } })
    renderApp(
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/portal" element={<p>portal page</p>} />
      </Routes>,
      { user: null },
    )
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'secret123')
    await userEvent.click(screen.getByLabelText('Remember me'))
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    await screen.findByText('portal page')
    expect(localStorage.getItem('thirdeye.token')).toBe('tok-2')
  })
})

async function fillRegister(overrides: Partial<Record<'name' | 'email' | 'phone' | 'password' | 'confirm', string>> = {}) {
  const v = { name: 'Asha Raman', email: 'asha@example.com', phone: '+919876543210', password: 'goodpass1', confirm: 'goodpass1', ...overrides }
  await userEvent.type(screen.getByLabelText('Full name'), v.name)
  await userEvent.type(screen.getByLabelText('Email'), v.email)
  await userEvent.type(screen.getByLabelText('Phone number'), v.phone)
  await userEvent.type(screen.getByLabelText('Password'), v.password)
  await userEvent.type(screen.getByLabelText('Confirm password'), v.confirm)
  await userEvent.click(screen.getByRole('button', { name: /create account/i }))
}

describe('Register', () => {
  it('flags a password mismatch', async () => {
    const fetchFn = mockFetch(201, {})
    renderApp(<Register />, { user: null })
    await fillRegister({ confirm: 'different1' })
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('flags a weak password (too short, and missing a digit)', async () => {
    renderApp(<Register />, { user: null })
    await fillRegister({ password: 'abc1', confirm: 'abc1' })
    expect(screen.getByText(/at least 8 characters/i, { selector: 'p.text-danger' })).toBeInTheDocument()
  })

  it('flags a password with no digit', async () => {
    renderApp(<Register />, { user: null })
    await fillRegister({ password: 'onlyletters', confirm: 'onlyletters' })
    expect(screen.getByText(/one letter and one digit/i, { selector: 'p.text-danger' })).toBeInTheDocument()
  })

  it('flags a bad phone number', async () => {
    renderApp(<Register />, { user: null })
    await fillRegister({ phone: '12ab' })
    expect(screen.getByText(/7 to 15 digits/i, { selector: 'p.text-danger' })).toBeInTheDocument()
  })

  it('creates the account and goes to /portal', async () => {
    const fetchFn = mockFetch(201, {
      token: 'tok-r',
      user: { id: 2, name: 'Asha Raman', email: 'asha@example.com', phone: '+919876543210' },
    })
    renderApp(
      <Routes>
        <Route path="/" element={<Register />} />
        <Route path="/portal" element={<p>portal page</p>} />
      </Routes>,
      { user: null },
    )
    await fillRegister()
    await screen.findByText('portal page')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/auth/register')
    expect(JSON.parse(init.body)).toEqual({
      name: 'Asha Raman',
      email: 'asha@example.com',
      phone: '+919876543210',
      password: 'goodpass1',
    })
  })

  it('shows the server message when the email is already registered', async () => {
    mockFetch(409, { detail: 'Email already registered' })
    renderApp(<Register />, { user: null })
    await fillRegister()
    await waitFor(() => expect(screen.getByText('Email already registered')).toBeInTheDocument())
  })
})

describe('ForgotPassword', () => {
  it('posts the email and shows the generic confirmation', async () => {
    const fetchFn = mockFetch(202, { message: 'If an account exists for that email, a reset link has been sent.' })
    renderApp(<ForgotPassword />, { user: null })
    await userEvent.type(screen.getByLabelText('Email'), 'asha@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset instructions/i }))
    expect(await screen.findByText(/reset link has been sent/i)).toBeInTheDocument()
    expect(fetchFn.mock.calls[0][0]).toBe('/api/auth/forgot-password')
  })
})
