import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi } from '../../test-api'
import { renderApp } from '../../test-utils'
import { Profile } from '../profile/Profile'
import { validateAge } from './accountValidation'

const PROFILE = { id: 1, name: 'Asha Raman', email: 'asha@example.com', phone: '+919876543210', age: 30 }
const GUARDIAN = { name: '', email: '', phone: '', relationship: '' }

afterEach(() => vi.unstubAllGlobals())

describe('validateAge', () => {
  it('allows blank, rejects non-numbers and out of range', () => {
    expect(validateAge('')).toBeUndefined()
    expect(validateAge('30')).toBeUndefined()
    expect(validateAge('abc')).toMatch(/whole number/)
    expect(validateAge('0')).toMatch(/between 1 and 120/)
    expect(validateAge('121')).toMatch(/between 1 and 120/)
  })
})

describe('Profile page', () => {
  it('validates the profile form without calling the server', async () => {
    const api = mockApi({ 'GET /profile': PROFILE, 'GET /guardian': GUARDIAN })
    renderApp(<Profile />)
    const name = await screen.findByLabelText('Full name')
    await userEvent.clear(name)
    await userEvent.clear(screen.getByLabelText('Phone number'))
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(screen.getByText('Enter your full name.')).toBeInTheDocument()
    expect(screen.getByText('Enter your phone number.')).toBeInTheDocument()
    expect(api.callsTo('PUT', '/profile')).toHaveLength(0)
  })

  it('saves the profile and shows a success toast', async () => {
    const api = mockApi({
      'GET /profile': PROFILE,
      'GET /guardian': GUARDIAN,
      'PUT /profile': (b: unknown) => ({ ...PROFILE, ...(b as object) }),
    })
    renderApp(<Profile />)
    const name = await screen.findByLabelText('Full name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Asha R')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByText('Profile saved')).toBeInTheDocument()
    expect(api.callsTo('PUT', '/profile')[0].body).toEqual({
      name: 'Asha R',
      age: 30,
      email: 'asha@example.com',
      phone: '+919876543210',
    })
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('shows the server error inline (duplicate email)', async () => {
    mockApi({
      'GET /profile': PROFILE,
      'GET /guardian': GUARDIAN,
      'PUT /profile': fail(409, 'An account with this email already exists'),
    })
    renderApp(<Profile />)
    await screen.findByLabelText('Full name')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument()
  })

  it('guardian: relationship Other asks for a description and saves it', async () => {
    const api = mockApi({ 'GET /profile': PROFILE, 'GET /guardian': GUARDIAN, 'PUT /guardian': (b: unknown) => b })
    renderApp(<Profile />)
    await screen.findByLabelText('Guardian name')
    await userEvent.type(screen.getByLabelText('Guardian name'), 'Ravi')
    await userEvent.type(screen.getByLabelText('Guardian email'), 'ravi@example.com')
    await userEvent.type(screen.getByLabelText('Guardian phone'), '9876543210')
    await userEvent.selectOptions(screen.getByLabelText('Relationship'), 'Other')
    await userEvent.click(screen.getByRole('button', { name: 'Save guardian' }))
    expect(screen.getByText('Enter the relationship.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Describe the relationship'), 'Neighbour')
    await userEvent.click(screen.getByRole('button', { name: 'Save guardian' }))
    expect(await screen.findByText('Guardian saved')).toBeInTheDocument()
    expect(api.callsTo('PUT', '/guardian')[0].body).toEqual({
      name: 'Ravi',
      email: 'ravi@example.com',
      phone: '9876543210',
      relationship: 'Neighbour',
    })
  })

  it('password: enforces policy and confirmation, then clears the form on success', async () => {
    const api = mockApi({
      'GET /profile': PROFILE,
      'GET /guardian': GUARDIAN,
      'POST /profile/change-password': { message: 'Password updated' },
    })
    renderApp(<Profile />)
    await screen.findByLabelText('Current password')
    await userEvent.type(screen.getByLabelText('Current password'), 'oldpass123')
    await userEvent.type(screen.getByLabelText('New password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'different')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(screen.getByText('Password must be at least 8 characters long.')).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(api.callsTo('POST', '/profile/change-password')).toHaveLength(0)

    await userEvent.clear(screen.getByLabelText('New password'))
    await userEvent.type(screen.getByLabelText('New password'), 'newpass123')
    await userEvent.clear(screen.getByLabelText('Confirm new password'))
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'newpass123')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByText('Password updated')).toBeInTheDocument()
    expect(api.callsTo('POST', '/profile/change-password')[0].body).toEqual({
      current_password: 'oldpass123',
      new_password: 'newpass123',
    })
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''))
  })
})
