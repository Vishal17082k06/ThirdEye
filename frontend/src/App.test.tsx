import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('shows a sign-in page placeholder at /login without crashing', () => {
    window.history.pushState({}, '', '/login')
    render(<App />)
    expect(screen.getAllByText(/log in/i).length).toBeGreaterThan(0)
  })
})
