import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, normaliseDetail } from './api'
import { clearToken, setToken } from './token'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    return e as ApiError
  }
  throw new Error('expected request to reject')
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearToken()
})

describe('normaliseDetail', () => {
  it('passes strings through', () => {
    expect(normaliseDetail('Invalid email or password', 'x')).toBe('Invalid email or password')
  })
  it('flattens 422 arrays into readable text', () => {
    const detail = [
      { loc: ['body', 'password'], msg: 'Value error, Password must be at least 8 characters long' },
      { loc: ['body', 'phone'], msg: 'Value error, Phone must have 7-15 digits' },
    ]
    expect(normaliseDetail(detail, 'x')).toBe(
      'password: Password must be at least 8 characters long. phone: Phone must have 7-15 digits',
    )
  })
  it('falls back when nothing usable is present', () => {
    expect(normaliseDetail(undefined, 'fallback')).toBe('fallback')
  })
})

describe('api', () => {
  it('sends JSON and the bearer token', async () => {
    setToken('abc', false)
    const fn = mockFetch(200, { ok: true })
    await api.post('/x', { a: 1 })
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe('/api/x')
    expect(init.headers.Authorization).toBe('Bearer abc')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"a":1}')
  })

  it('throws ApiError with status and message on 401', async () => {
    mockFetch(401, { detail: 'Invalid email or password' })
    const err = await rejection(api.post('/auth/login', {}))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    expect(err.message).toBe('Invalid email or password')
  })

  it('normalises 422 arrays', async () => {
    mockFetch(422, { detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email address' }] })
    const err = await rejection(api.post('/auth/register', {}))
    expect(err.status).toBe(422)
    expect(err.message).toBe('email: value is not a valid email address')
  })

  it('reports network failures with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fail')))
    const err = await rejection(api.get('/x'))
    expect(err.status).toBe(0)
    expect(err.message).toMatch(/cannot reach/i)
  })
})
