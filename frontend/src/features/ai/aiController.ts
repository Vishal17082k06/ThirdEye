import { useSyncExternalStore } from 'react'

/**
 * A tiny shared controller so something outside the AI page (the voice assistant) can drive the camera and obstacle
 * detection. The AI page still owns the camera and the detection loop; it attaches a handler here and reports its
 * status. A command is a request that resolves with what actually happened.
 *
 * If a command arrives while the AI page is not mounted it is queued and runs as soon as the page attaches (the
 * caller navigates to the page first). A request that is never picked up times out with an honest failure.
 */
export type AiCommandName = 'startCamera' | 'stopCamera' | 'startDetection' | 'stopDetection'

export interface AiResult {
  ok: boolean
  message: string
}

export type AiHandler = (command: AiCommandName) => Promise<AiResult>

export type AiCameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'no-device' | 'error'

export interface AiControllerState {
  /** The AI page is on screen and handling commands. */
  mounted: boolean
  camera: AiCameraStatus
  detecting: boolean
  /** Set when a voice-started camera did not start: the page shows a "Start camera" prompt with this text. */
  gesturePrompt: string | null
}

export const AI_QUEUE_TIMEOUT_MS = 6000

const INITIAL: AiControllerState = { mounted: false, camera: 'idle', detecting: false, gesturePrompt: null }

interface Queued {
  command: AiCommandName
  resolve: (r: AiResult) => void
  timer: ReturnType<typeof setTimeout>
}

export function createAiController() {
  let state: AiControllerState = INITIAL
  let handler: AiHandler | null = null
  let queue: Queued[] = []
  const listeners = new Set<() => void>()
  const set = (patch: Partial<AiControllerState>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  async function run(command: AiCommandName): Promise<AiResult> {
    try {
      return await handler!(command)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'The command failed.' }
    }
  }

  return {
    getState: (): AiControllerState => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Send a command to the AI page. Resolves with the page's own outcome. */
    request(command: AiCommandName, timeoutMs = AI_QUEUE_TIMEOUT_MS): Promise<AiResult> {
      if (handler) return run(command)
      return new Promise<AiResult>((resolve) => {
        const entry: Queued = {
          command,
          resolve,
          timer: setTimeout(() => {
            queue = queue.filter((q) => q !== entry)
            resolve({ ok: false, message: 'The AI Assistance page did not open in time, so nothing was started.' })
          }, timeoutMs),
        }
        queue.push(entry)
      })
    },
    /** Called by the AI page while mounted. Returns the detach function. Queued commands run in order. */
    attach(h: AiHandler): () => void {
      handler = h
      set({ mounted: true })
      const waiting = queue
      queue = []
      void (async () => {
        for (const q of waiting) {
          clearTimeout(q.timer)
          q.resolve(await run(q.command))
        }
      })()
      return () => {
        if (handler !== h) return
        handler = null
        set({ mounted: false, camera: 'idle', detecting: false, gesturePrompt: null })
      }
    },
    publishStatus(patch: Partial<Pick<AiControllerState, 'camera' | 'detecting'>>): void {
      const next = { ...state, ...patch }
      if (next.camera === state.camera && next.detecting === state.detecting) return
      set(patch)
    },
    setGesturePrompt(message: string | null): void {
      if (state.gesturePrompt !== message) set({ gesturePrompt: message })
    },
    reset(): void {
      queue.forEach((q) => clearTimeout(q.timer))
      queue = []
      handler = null
      state = INITIAL
      listeners.forEach((l) => l())
    },
  }
}

export type AiController = ReturnType<typeof createAiController>

/** The one controller the app shares. Tests call aiController.reset() between cases. */
export const aiController: AiController = createAiController()

export function useAiControllerState(): AiControllerState {
  return useSyncExternalStore(aiController.subscribe, aiController.getState, aiController.getState)
}
