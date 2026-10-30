import { vi } from 'vitest'

type Handler = unknown

export interface Call {
  method: string
  path: string
  search: string
  body: unknown
}

/**
 * Stubs global fetch with routes keyed "METHOD /path" (no /api prefix, no query string).
 * A handler may be a plain body or a function (body, url) => body. Unmatched requests return 404
 * so a missing mock fails loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname.replace(/^\/api/, '')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, search: url.search, body })
    const h = routes[`${method} ${path}`]
    if (h === undefined) return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 })
    const out = await (typeof h === 'function' ? (h as (b: unknown, u: URL) => unknown)(body, url) : h)
    if (out && typeof out === 'object' && '__status' in out) {
      const o = out as { __status: number; body: unknown }
      return new Response(JSON.stringify(o.body), { status: o.__status })
    }
    return new Response(JSON.stringify(out), { status: 200 })
  })
  vi.stubGlobal('fetch', fn)
  return {
    fn,
    calls,
    callsTo: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path),
  }
}

export const fail = (status: number, detail: string) => ({ __status: status, body: { detail } })

export const DEFAULT_SETTINGS = {
  camera: { deviceId: null, preferences: {} },
  hardware: { deviceIp: '', pollingIntervalMs: 1000, sensorSettings: {} },
  ai: { confidenceThreshold: 0.5, riskSettings: {}, openaiVisionEnabled: false },
  voice: { enabled: true, rate: 1, voiceName: null, feedback: true },
  accessibility: { textSize: 'md', highContrast: false, largeButtons: false },
  emergency: { contact: '' },
}
