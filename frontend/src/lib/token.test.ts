import { afterEach, describe, expect, it } from 'vitest'
import { clearToken, getToken, setToken } from './token'

const KEY = 'thirdeye.token'
afterEach(() => clearToken())

describe('token storage', () => {
  it('remember=true uses localStorage only', () => {
    setToken('a', true)
    expect(localStorage.getItem(KEY)).toBe('a')
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(getToken()).toBe('a')
  })

  it('remember=false uses sessionStorage only', () => {
    setToken('b', false)
    expect(sessionStorage.getItem(KEY)).toBe('b')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('setToken clears the other store so a stale token cannot linger', () => {
    setToken('old', true)
    setToken('new', false)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBe('new')
    setToken('newer', true)
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(KEY)).toBe('newer')
  })

  it('clearToken (used by logout) empties both stores', () => {
    localStorage.setItem(KEY, 'x')
    sessionStorage.setItem(KEY, 'y')
    clearToken()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(getToken()).toBeNull()
  })
})
