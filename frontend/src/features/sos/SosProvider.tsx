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
  telHref,
  useSosStatus,
  type SosRecord,
  type SosRequestBody,
  type SosStatus,
} from './api'

/** How long confirm waits for a first GPS fix before sending without coordinates. */
export const FIX_WAIT_MS = 4000

export type SosPhase = 'idle' | 'confirming' | 'sending' | 'done'

export interface SosState {
  phase: SosPhase
  /** Whether the confirmation/result dialog is showing. */
  open: boolean
  /** The latest server record. Delivery wording always comes from it. */
  result: SosRecord | null
  /** A request-level failure (no record exists): the alert was NOT sent. */
  error: string | null
}

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
  /** Opens the phone app for the guardian's number; false when there is none. */
  callGuardian: () => boolean
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

const NOT_SENT = 'The alert was NOT sent. Call your guardian directly.'

function describeFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return `Cannot reach the Third Eye server. ${NOT_SENT}`
    return `${err.message} ${NOT_SENT}`
  }
  return `Something went wrong. ${NOT_SENT}`
}

export function SosProvider({ children }: { children: ReactNode }) {
  const { mode } = useMode()
  const live = mode === 'live'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const statusQ = useSosStatus(live)
  const guardianQ = useQuery({ queryKey: GUARDIAN_KEY, queryFn: () => api.get<Guardian>('/guardian'), enabled: live })

  const [state, setState] = useState<SosState>({ phase: 'idle', open: false, result: null, error: null })
  const [dryRun, setDryRun] = useState(false)
  const [wanted, setWanted] = useState(false)
  const busy = useRef(false)

  // GPS is only read in Live mode, and only while the page or the dialog needs it.
  const geo = useGeolocation(live && (wanted || state.open))
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

  const apply = useCallback(
    (rec: SosRecord) => {
      setState((s) => ({ ...s, result: rec, error: null, phase: rec.status === 'pending' && !rec.retry_available ? 'sending' : 'done' }))
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
    setState({ phase: 'confirming', open: true, result: null, error: null })
  }, [live, ready, navigate])

  const confirm = useCallback(
    async (note?: string) => {
      if (busy.current) return
      busy.current = true
      setState((s) => ({ ...s, phase: 'sending', result: null, error: null }))
      try {
        const fix = await freshestFix()
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
        setState((s) => ({ ...s, phase: 'done', result: null, error: describeFailure(err) }))
      } finally {
        busy.current = false
      }
    },
    [apply, freshestFix],
  )

  const retry = useCallback(
    async (id: number) => {
      if (busy.current) return
      busy.current = true
      setState((s) => ({ ...s, phase: 'sending', error: null }))
      try {
        apply(await retrySos(id))
      } catch (err) {
        void qc.invalidateQueries({ queryKey: SOS_LIST_KEY })
        const msg =
          err instanceof ApiError && err.status === 409
            ? 'This alert can no longer be retried; it may already be sending. The list has been refreshed.'
            : describeFailure(err)
        setState((s) => ({ ...s, phase: 'done', error: msg }))
      } finally {
        busy.current = false
      }
    },
    [apply, qc],
  )

  const cancel = useCallback(() => {
    setState((s) => (s.phase === 'confirming' ? { phase: 'idle', open: false, result: null, error: null } : { ...s, open: false }))
  }, [])

  const dismissResult = useCallback(() => setState({ phase: 'idle', open: false, result: null, error: null }), [])

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

  const callGuardian = useCallback(() => {
    const href = telHref(guardianPhone)
    if (!href) return false
    window.location.href = href
    return true
  }, [guardianPhone])

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
      callGuardian,
      geo: { status: geo.status, position: geo.position },
      setLocationWanted: setWanted,
      dismissResult,
    }),
    [state, requestSend, confirm, cancel, retry, ready, live, statusQ.data, statusQ.isPending, statusQ.isError, guardianQ.data, guardianPhone, callGuardian, geo.status, geo.position, dismissResult],
  )

  return (
    <SosContext.Provider value={value}>
      {children}
      <SosConfirmDialog flow={value} />
      <SosDryRun open={dryRun} onClose={() => setDryRun(false)} />
    </SosContext.Provider>
  )
}
