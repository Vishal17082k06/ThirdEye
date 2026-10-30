import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_QUEUE_TIMEOUT_MS, createAiController } from './aiController'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('aiController', () => {
  it('runs a command immediately when the AI page is attached', async () => {
    const c = createAiController()
    const handler = vi.fn(async () => ({ ok: true, message: 'done' }))
    c.attach(handler)
    expect(c.getState().mounted).toBe(true)
    expect(await c.request('startCamera')).toEqual({ ok: true, message: 'done' })
    expect(handler).toHaveBeenCalledWith('startCamera')
  })

  it('queues commands until the page attaches, then runs them in order', async () => {
    const c = createAiController()
    const order: string[] = []
    const first = c.request('startCamera')
    const second = c.request('startDetection')
    c.attach(async (cmd) => {
      order.push(cmd)
      return { ok: true, message: cmd }
    })
    expect(await first).toEqual({ ok: true, message: 'startCamera' })
    expect(await second).toEqual({ ok: true, message: 'startDetection' })
    expect(order).toEqual(['startCamera', 'startDetection'])
  })

  it('fails honestly when the page never attaches', async () => {
    const c = createAiController()
    const p = c.request('startCamera')
    vi.advanceTimersByTime(AI_QUEUE_TIMEOUT_MS + 1)
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.message).toContain('did not open in time')
  })

  it('turns a throwing handler into a failed result', async () => {
    const c = createAiController()
    c.attach(async () => {
      throw new Error('boom')
    })
    expect(await c.request('stopCamera')).toEqual({ ok: false, message: 'boom' })
  })

  it('detaching resets camera state and unmounts', () => {
    const c = createAiController()
    const detach = c.attach(async () => ({ ok: true, message: '' }))
    c.publishStatus({ camera: 'active', detecting: true })
    expect(c.getState()).toMatchObject({ camera: 'active', detecting: true })
    detach()
    expect(c.getState()).toMatchObject({ mounted: false, camera: 'idle', detecting: false })
  })
})
