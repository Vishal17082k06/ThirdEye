import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGeolocation, type GeoFix, type GeoStatus } from '../../hooks/useGeolocation'
import { ApiError, api } from '../../lib/api'
import { useMode } from '../../lib/mode'
import { GUARDIAN_KEY, type Guardian } from '../account/useAccount'
import { SosDryRun } from '../simulation/SosDryRun'
import { SosConfirmDialog } from './SosConfirmDialog'
import {
  POLL_MS,
  SOS_LIST_KEY,
  fetchSos,
  postSos,
  retrySos,
  sosOneKey,
  useSosStatus,
  type SosRecord,
  type SosRequestBody,
  type SosStatus,
} from './api'

/** How long confirm waits for a first GPS fix before sending without coordinates. */
export const FIX_WAIT_MS = 2000
/** After an unknown outcome, look at the history again at these delays (ms) so a delayed send shows up. */
export const UNKNOWN_REFETCH_MS = [0, 5000, 15000]
const WARM_MS = 30_000

export type SosPhase = 'idle' | 'confirming' | 'sending' | 'done'

export interface SosState {
  phase: SosPhase
  /** Whether the confirmation/result dialog is showing. */
  open: boolean
  /** The latest server record. Delivery wording always comes from it. */
  result: SosRecord | null
  /** A request-level failure (no record exists). 'rejected' = the server refused it; 'unknown' = we cannot tell. */
  error: SosError | null
  /** When the current send started (ms), for the elapsed counter. */
  startedAt: number | null
  /** Waiting briefly for a first GPS fix before sending without one. */
  waitingForLocation: boolean
  /** The record being retried, so only its row shows a spinner. */
  retryingId: number | null
}

export interface SosError {
  kind: 'rejected' | 'unknown'
  message: string
  /** Set when the failed action was a retry of this record. */
  retryId: number | null
}

export const UNKNOWN_MESSAGE =
  'We could not confirm whether the alert was sent. Do not assume it was. Call your guardian now, and check SOS history below.'

export interface SosFlow {
  state: SosState
  /** Live mode with a guardian: opens the confirmation dialog. Simulation: opens the dry run. No guardian: goes to /sos. */
  requestSend: () => void
  /** Sends the alert (needs the dialog to be confirming). */
  confirm: (note?: string) => Promise<void>
  cancel: () => void
  retry: (id: number) => Promise<void>
  /** Live mode and the server says a guardian email is set. */
  ready: boolean
  live: boolean
  status: SosStatus | undefined
  statusLoading: boolean
  statusError: boolean
  guardian: Guardian | undefined
  guardianPhone: string | null
  /** Starts GPS early (shortcut hover/focus) for a short while. */
  warmLocation: () => void
  /** Repeat the last action after an unknown outcome (may send a duplicate). */
  sendAgain: () => Promise<void>
  geo: { status: GeoStatus; position: GeoFix | null }
  /** The page asks for live GPS while it is mounted. */
  setLocationWanted: (wanted: boolean) => void
  dismissResult: () => void
}

const SosContext = createContext<SosFlow | null>(null)

/** For the topbar, which must still render (as a plain link) where no provider exists. */
export function useOptionalSosFlow(): SosFlow | null {
  return useContext(SosContext)
}

export function useSosFlow(): SosFlow {
  const ctx = useContext(SosContext)
  if (!ctx) throw new Error('useSosFlow must be used inside <SosProvider>')
  return ctx
}

/** 4xx is the server saying no (nothing was sent). Network failure, timeout/abort and 5xx are unknown. */
function classify(err: unknown, retryId: number | null): SosError {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
    const message =
      err.status === 409
        ? 'The alert was not sent: it can no longer be retried; it may already be sending. The list has been refreshed.'
        : `The alert was not sent: ${err.message}`
    return { kind: 'rejected', message, retryId }
  }
  return { kind: 'unknown', message: UNKNOWN_MESSAGE, retryId }
}

const IDLE: SosState = { phase: 'idle', open: false, result: null, error: null, startedAt: null, waitingForLocation: false, retryingId: null }

export function SosProvider({ children }: { children: ReactNode }) {
  const { mode } = useMode()
  const live = mode === 'live'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const statusQ = useSosStatus(live)
  const guardianQ = useQuery({ queryKey: GUARDIAN_KEY, queryFn: () => api.get<Guardian>('/guardian'), enabled: live })

  const [state, setState] = useState<SosState>(IDLE)
  const [dryRun, setDryRun] = useState(false)
  const [wanted, setWanted] = useState(false)
  const [warm, setWarm] = useState(false)
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const lastNote = useRef('')
  const busy = useRef(false)

  // GPS is only read in Live mode, and only while the page or the dialog needs it.
  const geo = useGeolocation(live && (wanted || warm || state.open))
  const posRef = useRef<GeoFix | null>(null)
  const geoStatusRef = useRef<GeoStatus>('idle')
  useEffect(() => {
    posRef.current = geo.position
    geoStatusRef.current = geo.status
  })

  const ready = live && !!statusQ.data?.guardian_ready
  const guardianPhone = guardianQ.data?.phone?.trim() || null

  /** Latest fix, waiting up to FIX_WAIT_MS for the first one. Never invents coordinates. */
  const freshestFix = useCallback(async (): Promise<GeoFix | null> => {
    const end = Date.now() + FIX_WAIT_MS
    while (!posRef.current && Date.now() < end) {
      const s = geoStatusRef.current
      if (s === 'denied' || s === 'unavailable') break
      await new Promise((r) => setTimeout(r, 100))
    }
    return posRef.current
  }, [])

  const warmLocation = useCallback(() => {
    setWarm(true)
    if (warmTimer.current) clearTimeout(warmTimer.current)
    warmTimer.current = setTimeout(() => setWarm(false), WARM_MS)
  }, [])

  // A delayed send must still show up: look at the history now and again a little later.
  const refetchSoon = useCallback(() => {
    for (const ms of UNKNOWN_REFETCH_MS) {
      if (ms === 0) void qc.invalidateQueries({ queryKey: SOS_LIST_KEY })
      else timers.current.push(setTimeout(() => void qc.invalidateQueries({ queryKey: SOS_LIST_KEY }), ms))
    }
  }, [qc])
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      if (warmTimer.current) clearTimeout(warmTimer.current)
    },
    [],
  )

  const apply = useCallback(
    (rec: SosRecord) => {
      setState((s) => ({ ...s, result: rec, error: null, startedAt: null, waitingForLocation: false, retryingId: null, phase: rec.status === 'pending' && !rec.retry_available ? 'sending' : 'done' }))
      void qc.invalidateQueries({ queryKey: SOS_LIST_KEY })
    },
    [qc],
  )

  const requestSend = useCallback(() => {
    if (!live) {
      setDryRun(true)
      return
    }
    if (!ready) {
      void navigate('/sos')
      return
    }
    if (busy.current) {
      setState((s) => ({ ...s, open: true }))
      return
    }
    setState({ ...IDLE, phase: 'confirming', open: true })
  }, [live, ready, navigate])

  const confirm = useCallback(
    async (note?: string) => {
      if (busy.current) return
      busy.current = true
      lastNote.current = note ?? ''
      const needsWait = !posRef.current && geoStatusRef.current !== 'denied' && geoStatusRef.current !== 'unavailable'
      setState((s) => ({ ...s, phase: 'sending', result: null, error: null, startedAt: Date.now(), waitingForLocation: needsWait, retryingId: null }))
      try {
        const fix = await freshestFix()
        setState((s) => ({ ...s, waitingForLocation: false }))
        const body: SosRequestBody = {}
        if (fix) {
          body.lat = fix.lat
          body.lon = fix.lon
          if (fix.accuracy != null) body.accuracy_m = fix.accuracy
        }
        const text = note?.trim()
        if (text) body.note = text.slice(0, 300)
        apply(await postSos(body))
      } catch (err) {
        const e = classify(err, null)
        if (e.kind === 'unknown') refetchSoon()
        setState((s) => ({ ...s, phase: 'done', result: null, error: e, startedAt: null, waitingForLocation: false }))
      } finally {
        busy.current = false
      }
    },
    [apply, freshestFix, refetchSoon],
  )

  const retry = useCallback(
    async (id: number) => {
      if (busy.current) return
      busy.current = true
      setState((s) => ({ ...s, phase: 'sending', error: null, startedAt: Date.now(), retryingId: id }))
      try {
        apply(await retrySos(id))
      } catch (err) {
        void qc.invalidateQueries({ queryKey: SOS_LIST_KEY })
        const e = classify(err, id)
        if (e.kind === 'unknown') refetchSoon()
        setState((s) => ({ ...s, phase: 'done', error: e, startedAt: null, retryingId: null }))
      } finally {
        busy.current = false
      }
    },
    [apply, qc, refetchSoon],
  )

  const cancel = useCallback(() => {
    setState((s) => (s.phase === 'confirming' ? IDLE : s.phase === 'sending' && !s.result ? s : { ...s, open: false }))
  }, [])

  const dismissResult = useCallback(() => setState(IDLE), [])

  // While the result is pending the server may finish it; follow it until it settles.
  const pendingId = state.result?.status === 'pending' ? state.result.id : null
  const follow = useQuery({
    queryKey: pendingId ? sosOneKey(pendingId) : ['sos', 'one', 'none'],
    queryFn: () => fetchSos(pendingId as number),
    enabled: pendingId != null,
    refetchInterval: POLL_MS,
    gcTime: 0,
  })
  useEffect(() => {
    if (follow.data && follow.data.id === pendingId && follow.data.status !== 'pending') apply(follow.data)
  }, [follow.data, pendingId, apply])

  const sendAgain = useCallback(async () => {
    const id = state.error?.retryId
    if (id != null) await retry(id)
    else await confirm(lastNote.current)
  }, [state.error, retry, confirm])

  const value = useMemo<SosFlow>(
    () => ({
      state,
      requestSend,
      confirm,
      cancel,
      retry,
      ready,
      live,
      status: statusQ.data,
      statusLoading: live && statusQ.isPending,
      statusError: live && statusQ.isError,
      guardian: guardianQ.data,
      guardianPhone,
      warmLocation,
      sendAgain,
      geo: { status: geo.status, position: geo.position },
      setLocationWanted: setWanted,
      dismissResult,
    }),
    [state, requestSend, confirm, cancel, retry, ready, live, statusQ.data, statusQ.isPending, statusQ.isError, guardianQ.data, guardianPhone, warmLocation, sendAgain, geo.status, geo.position, dismissResult],
  )

  return (
    <SosContext.Provider value={value}>
      {children}
      <SosConfirmDialog flow={value} />
      <SosDryRun open={dryRun} onClose={() => setDryRun(false)} />
    </SosContext.Provider>
  )
}
