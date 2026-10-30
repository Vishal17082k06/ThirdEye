import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpeech } from '../../hooks/useSpeech'
import { ApiError, api } from '../../lib/api'
import { useMode } from '../../lib/mode'
import { useSettings } from '../../lib/settings'
import { aiController } from '../ai/aiController'
import { GUARDIAN_KEY, type Guardian } from '../account/useAccount'
import { DEVICES_KEY, type Device } from '../devices/useDevices'
import type { GeocodeResult } from '../maps/api'
import { navigationController } from '../navigation/controller'
import { useWhereAmI } from '../navigation/useWhereAmI'
import { useSosFlow } from '../sos/SosProvider'
import { describeCommand } from './commands'
import { createExecutor, readScreen, type ExecutorDeps, type GeoPermission, type Reply } from './executor'
import { useSpeechRecognition, UNSUPPORTED_MESSAGE } from './useSpeechRecognition'
import { VoiceContext, type VoiceApi, type VoiceEntry } from './voiceContext'

const HISTORY_LIMIT = 5
/** Above routine navigation guidance (rank 0), below hazard warnings (high 2, critical 3). */
const SPEECH_RANK = 1
const OFF_MESSAGE = 'The voice assistant is turned off in Settings. Typed commands still work.'

async function queryGeoPermission(): Promise<GeoPermission> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' })
    return status ? status.state : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * The global voice assistant. Mounted once in the Shell (inside the router, SOS and navigation providers).
 * It listens only after a button press or the keyboard shortcut, one utterance at a time, and never records audio.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { mode } = useMode()
  const settings = useSettings().data?.voice
  const enabled = settings ? settings.enabled : true
  const speech = useSpeech()
  const { ask: whereAmI } = useWhereAmI()
  const sos = useSosFlow()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<VoiceEntry[]>([])
  const [awaiting, setAwaiting] = useState<{ choices: number } | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const nextId = useRef(1)

  // Always-current dependencies for the executor (which is created once).
  const depsRef = useRef<ExecutorDeps>(null as unknown as ExecutorDeps)
  depsRef.current = {
    navigate: (to) => {
      if (typeof to === 'number') void navigate(to)
      else void navigate(to)
    },
    ai: { request: (c) => aiController.request(c), state: () => aiController.getState() },
    nav: {
      setDestination: navigationController.setDestination,
      setMode: navigationController.setMode,
      start: navigationController.start,
      getState: navigationController.getState,
    },
    whereAmI,
    geocode: async (q) => (await api.get<{ results: GeocodeResult[] }>(`/nav/geocode?q=${encodeURIComponent(q)}`)).results ?? [],
    getDevices: () =>
      qc.fetchQuery({ queryKey: DEVICES_KEY, queryFn: async () => (await api.get<{ items: Device[] }>('/devices')).items, staleTime: 5000 }),
    geoPermission: queryGeoPermission,
    simulation: mode === 'simulation',
    getGuardian: async () => {
      try {
        const g = await qc.fetchQuery({ queryKey: GUARDIAN_KEY, queryFn: () => api.get<Guardian>('/guardian'), staleTime: 30_000 })
        return g ? { name: g.name, phone: g.phone } : null
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    sos: {
      live: sos.live,
      ready: sos.ready,
      requestSend: sos.requestSend,
      confirmOpen: () => sos.state.open && sos.state.phase === 'confirming',
      confirm: () => void sos.confirm(),
      cancel: sos.cancel,
    },
    readScreen: () => readScreen(document),
    dial: (href) => {
      window.location.href = href
    },
  }

  const speakRef = useRef(speech.speak)
  speakRef.current = speech.speak

  const present = useCallback((reply: Reply, heard: string, via: VoiceEntry['via']) => {
    const entry: VoiceEntry = {
      id: nextId.current++,
      heard,
      interpreted: reply.parsed ? describeCommand(reply.parsed) : null,
      response: reply.text,
      ok: reply.ok,
      via,
    }
    setHistory((h) => [entry, ...h].slice(0, HISTORY_LIMIT))
    setAwaiting(reply.awaiting ? { choices: reply.choices ?? 0 } : null)
    if (reply.showHelp) setShowHelp(true)
    setNotice(null)
    if (!reply.alreadySpoken) speakRef.current(reply.text, { interrupt: true, rank: SPEECH_RANK })
  }, [])

  const presentRef = useRef(present)
  presentRef.current = present

  const executor = useMemo(
    () =>
      createExecutor(() => depsRef.current, {
        onExpire: (reply) => presentRef.current(reply, '', 'voice'),
      }),
    [],
  )

  const stopRef = useRef<() => void>(() => undefined)

  const runCommand = useCallback(
    async (text: string, via: VoiceEntry['via'] = 'typed') => {
      const heard = text.trim()
      if (!heard) return
      setBusy(true)
      try {
        const reply = await executor.execute(heard)
        present(reply, heard, via)
        if (reply.stopListening) stopRef.current()
      } finally {
        setBusy(false)
      }
    },
    [executor, present],
  )

  const recognition = useSpeechRecognition({ onFinal: (t) => void runCommand(t, 'voice') })
  stopRef.current = recognition.stop
  const { status, start, stop, error: recognitionError } = recognition

  const toggleListening = useCallback(() => {
    setOpen(true)
    if (status === 'listening' || status === 'processing') {
      stop()
      return
    }
    if (!enabled) {
      setNotice(OFF_MESSAGE)
      return
    }
    if (status === 'unsupported') {
      setNotice(UNSUPPORTED_MESSAGE)
      return
    }
    // The assistant must not hear itself: stop any reply that is still being spoken.
    speech.cancel()
    setNotice(null)
    start()
  }, [enabled, speech, start, stop, status])

  const toggleRef = useRef(toggleListening)
  toggleRef.current = toggleListening

  // Keyboard alternative: Alt+Shift+V toggles listening (and opens the panel).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'KeyV' || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return
      e.preventDefault()
      toggleRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Turning the assistant off in Settings switches the microphone off immediately.
  useEffect(() => {
    if (!enabled) stopRef.current()
  }, [enabled])

  const value: VoiceApi = {
    open,
    setOpen,
    enabled,
    status,
    listening: status === 'listening',
    interim: recognition.interim,
    error: notice ?? (status === 'error' ? recognitionError : null),
    busy,
    last: history[0] ?? null,
    history,
    awaiting,
    showHelp,
    setShowHelp,
    toggleListening,
    runCommand: (text, via = 'typed') => runCommand(text, via),
  }

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}
