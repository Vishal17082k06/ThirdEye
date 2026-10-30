import { QueryClient } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../lib/auth'
import { clearToken } from '../../lib/token'
import { mockApi } from '../../test-api'
import { renderApp, TEST_USER } from '../../test-utils'
import { GuardianForm, ProfileForm } from './AccountForms'

const A = { id: 1, name: 'Alice A', email: 'a@example.com', phone: '+911111111111', age: 31 }
const B = { id: 2, name: 'Bob B', email: 'b@example.com', phone: '+922222222222', age: null }

afterEach(() => {
  vi.unstubAllGlobals()
  clearToken()
})

function Harness() {
  const { user, login, logout } = useAuth()
  // Like ProtectedRoute: account pages are only mounted while someone is signed in.
  return (
    <div>
      <button onClick={logout}>Sign out</button>
      <button onClick={() => login('b@example.com', 'secret123', false)}>Sign in as Bob</button>
      {user ? (
        <>
          <ProfileForm />
          <GuardianForm />
        </>
      ) : (
        <p>Signed out</p>
      )}
    </div>
  )
}

describe('account data across sessions', () => {
  it('does not show user A data to user B and never PUTs A values as B', async () => {
    let current: { id: number; name: string; email: string; phone: string; age: number | null } = A
    const api = mockApi({
      'GET /profile': () => current,
      'GET /guardian': () => ({ name: current === A ? 'Alice Guardian' : '', email: '', phone: '', relationship: '' }),
      'PUT /profile': (b: unknown) => ({ ...current, ...(b as object) }),
      'POST /auth/login': () => {
        current = B
        return { token: 't-b', user: { id: 2, name: B.name, email: B.email, phone: B.phone } }
      },
    })
    // Default gcTime (5 min): without an explicit clear on logout A's cached data would survive.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderApp(<Harness />, { user: { ...TEST_USER, id: 1 }, queryClient: client })

    expect(await screen.findByDisplayValue('Alice A')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Alice Guardian')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByText('Signed out')).toBeInTheDocument()
    expect(client.getQueryCache().getAll()).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Sign in as Bob' }))
    expect(await screen.findByDisplayValue('Bob B')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Alice A')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Alice Guardian')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByText('Profile saved')).toBeInTheDocument()
    const put = api.callsTo('PUT', '/profile')
    expect(put).toHaveLength(1)
    expect(put[0].body).toMatchObject({ name: 'Bob B', email: 'b@example.com', age: null })
  })

  it('refreshes a clean form when fresh server data arrives, but keeps unsaved edits', async () => {
    let server = { ...A }
    mockApi({ 'GET /profile': () => server, 'GET /guardian': { name: '', email: '', phone: '', relationship: '' } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderApp(<ProfileForm />, { queryClient: client })
    expect(await screen.findByDisplayValue('Alice A')).toBeInTheDocument()

    server = { ...A, name: 'Alice Renamed' }
    await client.refetchQueries({ queryKey: ['profile'] })
    expect(await screen.findByDisplayValue('Alice Renamed')).toBeInTheDocument()

    const email = screen.getByLabelText('Email')
    await userEvent.clear(email)
    await userEvent.type(email, 'typing@example.com')
    server = { ...A, name: 'Server Again' }
    await client.refetchQueries({ queryKey: ['profile'] })
    expect(screen.getByLabelText('Email')).toHaveValue('typing@example.com')
  })

  it('a blank age is sent as null (the backend treats null as clearing the age)', async () => {
    const api = mockApi({
      'GET /profile': A,
      'PUT /profile': (b: unknown) => ({ ...A, ...(b as object) }),
    })
    renderApp(<ProfileForm />)
    const age = await screen.findByLabelText('Age')
    await userEvent.clear(age)
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByText('Profile saved')).toBeInTheDocument()
    expect(api.callsTo('PUT', '/profile')[0].body).toMatchObject({ age: null })
  })
})
