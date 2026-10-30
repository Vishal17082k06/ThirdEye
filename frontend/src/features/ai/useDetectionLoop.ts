import { useEffect, useRef } from 'react'
import type { ClientEventSource } from '../../lib/events'
import { detectImage, EngineUnavailableError, type DetectResult } from './detect'

/** Pause between the end of one request and the start of the next. One request is ever in flight. */
export const DETECT_INTERVAL_MS = 1200
/** The server logs a record at most this often (the client only sets record=true after this long). */
export const RECORD_EVERY_MS = 5000
const MAX_CONSECUTIVE_ERRORS = 3

interface Options {
  enabled: boolean
  source: ClientEventSource
  captureFrame: () => Promise<Blob>
  onResult: (result: DetectResult) => void
  onUnavailable: (message: string) => void
  onError: (message: string, fatal: boolean) => void
}

/**
 * Periodic frame upload while obstacle detection is on.
 * Sequential by construction (setTimeout chain, not setInterval), skipped while the tab is hidden,
 * aborted on stop and unmount, and stopped for good if the engine is unavailable.
 */
export function useDetectionLoop(options: Options): void {
  const opts = useRef(options)
  opts.current = options
  const { enabled, source } = options

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: number | undefined
    let controller: AbortController | null = null
    let lastRecord = -Infinity
    let failures = 0

    const schedule = () => {
      if (!cancelled) timer = window.setTimeout(tick, DETECT_INTERVAL_MS)
    }

    async function tick() {
      if (cancelled) return
      if (document.hidden) return schedule()
      const o = opts.current
      try {
        const frame = await o.captureFrame()
        if (cancelled) return
        const now = Date.now()
        const record = now - lastRecord >= RECORD_EVERY_MS
        controller = new AbortController()
        const result = await detectImage(frame, { source, record, signal: controller.signal })
        if (cancelled) return
        if (record) lastRecord = now
        failures = 0
        opts.current.onResult(result)
      } catch (err) {
        if (cancelled || (err as DOMException)?.name === 'AbortError') return
        if (err instanceof EngineUnavailableError) {
          cancelled = true
          opts.current.onUnavailable(err.message)
          return
        }
        failures += 1
        const fatal = failures >= MAX_CONSECUTIVE_ERRORS
        opts.current.onError(err instanceof Error ? err.message : 'Detection failed.', fatal)
        if (fatal) {
          cancelled = true
          return
        }
      }
      schedule()
    }

    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller?.abort()
    }
  }, [enabled, source])
}
