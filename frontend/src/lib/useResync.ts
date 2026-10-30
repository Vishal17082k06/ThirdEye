import { useEffect, useRef } from 'react'

/**
 * Keeps a local form draft in step with server data without clobbering edits.
 * When `server` changes and the draft still equals the previous server copy (the user has not
 * typed anything), the draft is replaced with the fresh data. If the user has unsaved edits
 * they are kept, and "dirty" (draft vs `server`) simply reflects the new baseline.
 */
export function useResync<T>(server: T, draft: T, setDraft: (value: T) => void): void {
  const last = useRef(JSON.stringify(server))
  useEffect(() => {
    const next = JSON.stringify(server)
    if (next === last.current) return
    const wasClean = JSON.stringify(draft) === last.current
    last.current = next
    if (wasClean) setDraft(server)
  }, [server, draft, setDraft])
}
