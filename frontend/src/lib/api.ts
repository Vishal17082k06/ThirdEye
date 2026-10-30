import { getToken } from './token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface ValidationItem {
  loc?: Array<string | number>
  msg?: string
}

/** Turns FastAPI's `detail` (a string, or an array of validation items) into one readable sentence. */
export function normaliseDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length > 0) {
    const messages = detail.map((item: ValidationItem) => {
      const msg = (item?.msg ?? 'Invalid value').replace(/^Value error,\s*/i, '')
      const field = item?.loc?.filter((p) => p !== 'body').at(-1)
      return typeof field === 'string' ? `${field}: ${msg}` : msg
    })
    return [...new Set(messages)].join('. ')
  }
  return fallback
}

type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null

/** AuthProvider registers this so any 401 on an authenticated call signs the user out. */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  unauthorizedHandler = fn
}

// Credential endpoints legitimately return 401 ("wrong password"); that is not an expired session.
const SKIP_UNAUTHORIZED = ['/auth/login', '/auth/register', '/auth/forgot-password']

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    // A caller that cancelled on purpose (stale search, unmounted page) must be able to tell it apart from a network failure.
    if (signal?.aborted) throw err
    throw new ApiError(0, 'Cannot reach the Third Eye server. Check your connection and try again.')
  }

  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !SKIP_UNAUTHORIZED.includes(path)) unauthorizedHandler?.()
    const detail = (data as { detail?: unknown } | null)?.detail
    throw new ApiError(res.status, normaliseDetail(detail, `Request failed (${res.status}).`))
  }
  return data as T
}

export const api = {
  get: <T>(path: string, opts?: { signal?: AbortSignal }) => request<T>('GET', path, undefined, opts?.signal),
  post: <T>(path: string, body?: unknown, opts?: { signal?: AbortSignal }) => request<T>('POST', path, body, opts?.signal),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
