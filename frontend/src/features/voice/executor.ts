import { inServiceArea } from '../../lib/geo'
import type { AiCommandName, AiControllerState, AiResult } from '../ai/aiController'
import type { Device, DeviceStatusValue } from '../devices/useDevices'
import type { GeocodeResult, Place, RouteMode } from '../maps/api'
import type { ActionResult, NavigationState } from '../navigation/controller'
import { parseCommand, type Intent, type ParsedCommand } from './commands'

/**
 * Connects parsed commands to real app functionality. Everything it touches is injected (ExecutorDeps), so the
 * logic is unit-testable without a browser. The text it returns is what the assistant both shows and speaks, and it
 * only ever describes what the dependencies reported: it never claims an action that did not happen.
 */

/** A question (yes/no, "say the number") waits this long before it is cancelled. */
export const CONFIRM_TIMEOUT_MS = 10_000
export const MAX_SCREEN_CHARS = 600
export const MAX_CHOICES = 3

export type GeoPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

export interface ExecutorDeps {
  navigate: (to: string | number) => void
  ai: { request: (command: AiCommandName) => Promise<AiResult>; state: () => AiControllerState }
  nav: {
    setDestination: (place: Place | null) => ActionResult
    setMode: (mode: RouteMode) => void
    start: () => ActionResult
    getState: () => NavigationState
  }
  /** Answers "Where am I?" (and speaks it itself). */
  whereAmI: () => Promise<string>
  geocode: (query: string) => Promise<GeocodeResult[]>
  getDevices: () => Promise<Device[]>
  geoPermission: () => Promise<GeoPermission>
  simulation: boolean
  getGuardian: () => Promise<{ name: string; phone: string } | null>
  sos: {
    live: boolean
    ready: boolean
    requestSend: () => void
    /** True only while the SOS confirmation dialog is open and waiting for a decision. */
    confirmOpen: () => boolean
    confirm: () => void
    cancel: () => void
  }
  readScreen: () => string
  /** Best effort: is there a page to go back to? */
  canGoBack: () => boolean
  dial: (href: string) => void
}

export interface Reply {
  text: string
  ok: boolean
  parsed: ParsedCommand | null
  /** The dependency already spoke this text (Where am I speaks for itself). */
  alreadySpoken?: boolean
  /** The person asked to stop listening. */
  stopListening?: boolean
  showHelp?: boolean
  /** The assistant asked a question and is waiting for an answer. */
  awaiting?: boolean
  /** With awaiting: the number of numbered options the person can pick from (touch buttons). */
  choices?: number
}

type Pending =
  | { kind: 'where' }
  | { kind: 'choose'; options: Place[] }
  | { kind: 'nav'; place: Place }
  | { kind: 'call'; name: string; phone: string }

/** First two comma-separated parts of a long address, which is enough to say aloud. */
export function shortLabel(label: string): string {
  return label.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2).join(', ') || label
}

const STATUS_WORDS: Record<DeviceStatusValue, string> = {
  connected: 'connected',
  disconnected: 'disconnected',
  not_integrated: 'not integrated yet',
  unknown: 'status unknown',
  error: 'error',
}

export function describeDevices(devices: Device[], geo: GeoPermission, simulation: boolean): string {
  if (devices.length === 0) return 'The server returned no devices.'
  const parts = devices.map((d) => {
    const base = `${d.name}: ${STATUS_WORDS[d.status] ?? d.status}`
    return d.status === 'error' && d.error ? `${base} (${d.error})` : base
  })
  const geoWord = { granted: 'allowed', denied: 'blocked', prompt: 'not asked yet', unknown: 'unknown' }[geo]
  let text = `Device status. ${parts.join('. ')}. Location permission: ${geoWord}.`
  if (simulation) text += ' You are in Simulation mode: simulated tools do not change real device status, so these are the real reports.'
  return text
}

/** Page heading plus key content of the current page, kept short enough to listen to. */
export function readScreen(doc: Document = document): string {
  const main = doc.querySelector('main')
  if (!main) return 'I cannot find the page content to read.'
  const clean = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const uniq = (items: string[]) => items.filter((t, i) => t && items.indexOf(t) === i)
  const h1 = main.querySelector('h1')
  const title = h1 ? clean(h1) : ''
  const sections = uniq(Array.from(main.querySelectorAll('h2')).map(clean)).slice(0, 6)
  const regions = uniq(
    Array.from(doc.querySelectorAll('[role="alert"], main [role="status"], main [aria-live]:not([aria-live="off"])')).map(clean),
  ).slice(0, 4)
  const parts: string[] = []
  parts.push(title ? `This is the ${title} page.` : 'This page has no main heading.')
  if (sections.length) parts.push(`Sections: ${sections.join(', ')}.`)
  if (regions.length) parts.push(`Status: ${regions.join('. ')}`)
  const text = parts.join(' ')
  return text.length > MAX_SCREEN_CHARS ? `${text.slice(0, MAX_SCREEN_CHARS - 1).trimEnd()}…` : text
}

const unknownText = (heard: string) => `Sorry, I didn't understand "${heard}". Try saying: open dashboard.`

const PAGE: Partial<Record<Intent, { path: string; say: string }>> = {
  open_dashboard: { path: '/dashboard', say: 'Opening the dashboard.' },
  open_ai: { path: '/ai', say: 'Opening AI Assistance.' },
  open_navigation: { path: '/navigation', say: 'Opening Navigation.' },
  open_rides: { path: '/rides', say: 'Opening Book a Ride.' },
}

const AI_INTENT: Partial<Record<Intent, AiCommandName>> = {
  start_camera: 'startCamera',
  stop_camera: 'stopCamera',
  start_detection: 'startDetection',
  stop_detection: 'stopDetection',
}

export function createExecutor(getDeps: () => ExecutorDeps, opts: { timeoutMs?: number; onExpire?: (reply: Reply) => void } = {}) {
  const timeoutMs = opts.timeoutMs ?? CONFIRM_TIMEOUT_MS
  let pending: Pending | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearPending = () => {
    pending = null
    if (timer) clearTimeout(timer)
    timer = null
  }
  const ask = (p: Pending, text: string, parsed: ParsedCommand | null): Reply => {
    clearPending()
    pending = p
    timer = setTimeout(() => {
      if (pending !== p) return
      clearPending()
      opts.onExpire?.({ text: 'Cancelled. I did not hear an answer.', ok: true, parsed: null })
    }, timeoutMs)
    return { text, ok: true, parsed, awaiting: true }
  }
  const done = (parsed: ParsedCommand | null, text: string, ok = true, extra: Partial<Reply> = {}): Reply => ({ text, ok, parsed, ...extra })

  async function runAi(parsed: ParsedCommand, command: AiCommandName): Promise<Reply> {
    const d = getDeps()
    const starting = command === 'startCamera' || command === 'startDetection'
    if (!d.ai.state().mounted) {
      if (!starting) {
        const what = command === 'stopCamera' ? 'The camera is already off.' : 'Obstacle detection is already off.'
        return done(parsed, `${what} They only run on the AI Assistance page.`)
      }
      d.navigate('/ai')
    }
    const r = await d.ai.request(command)
    return done(parsed, r.message, r.ok)
  }

  async function startNavigation(parsed: ParsedCommand | null, place: Place): Promise<Reply> {
    const d = getDeps()
    d.navigate('/navigation')
    const set = d.nav.setDestination(place)
    if (!set.ok) return done(parsed, set.message ?? 'That destination cannot be used.', false)
    const started = d.nav.start()
    if (!started.ok) return done(parsed, started.message ?? 'Navigation could not be started.', false)
    return done(parsed, `Starting navigation to ${shortLabel(place.label)}. The route is being planned; follow the guidance on the Navigation page.`)
  }

  async function findDestination(parsed: ParsedCommand | null, query: string): Promise<Reply> {
    const d = getDeps()
    let results: GeocodeResult[]
    try {
      results = await d.geocode(query)
    } catch (err) {
      const why = err instanceof Error && err.message ? ` ${err.message}` : ''
      return done(parsed, `I could not search for "${query}" right now.${why}`, false)
    }
    const inside = results.filter((r) => inServiceArea(r.lat, r.lon)).slice(0, MAX_CHOICES)
    if (inside.length === 0) return done(parsed, `I couldn't find ${query} inside Coimbatore.`, false)
    const places: Place[] = inside.map((r) => ({ lat: r.lat, lon: r.lon, label: r.label }))
    if (places.length === 1) {
      return ask({ kind: 'nav', place: places[0] }, `Start navigation to ${shortLabel(places[0].label)}? Say yes or no.`, parsed)
    }
    const list = places.map((p, i) => `${i + 1}, ${shortLabel(p.label)}`).join('. ')
    return { ...ask({ kind: 'choose', options: places }, `I found ${places.length} places. ${list}. Say the number, or say cancel.`, parsed), choices: places.length }
  }

  async function dispatch(parsed: ParsedCommand): Promise<Reply> {
    const d = getDeps()
    const { intent } = parsed
    const page = PAGE[intent]
    if (page) {
      d.navigate(page.path)
      return done(parsed, page.say)
    }
    const aiCommand = AI_INTENT[intent]
    if (aiCommand) return runAi(parsed, aiCommand)

    switch (intent) {
      case 'where_am_i': {
        const text = await d.whereAmI()
        return done(parsed, text, true, { alreadySpoken: true })
      }
      case 'navigate_to': {
        const dest = parsed.args.destination
        if (!dest) return ask({ kind: 'where' }, 'Where would you like to go?', parsed)
        return findDestination(parsed, dest)
      }
      case 'mode_walk':
      case 'mode_car': {
        const walk = intent === 'mode_walk'
        d.nav.setMode(walk ? 'foot' : 'car')
        const dest = d.nav.getState().destination
        const base = walk ? 'Walking mode selected.' : 'Car mode selected.'
        return done(parsed, dest ? `${base} The route to ${shortLabel(dest.label)} will be re-planned.` : base)
      }
      case 'device_status': {
        try {
          const [devices, geo] = await Promise.all([d.getDevices(), d.geoPermission()])
          return done(parsed, describeDevices(devices, geo, d.simulation))
        } catch (err) {
          const why = err instanceof Error && err.message ? ` ${err.message}` : ''
          return done(parsed, `I could not load the device status.${why}`, false)
        }
      }
      case 'read_screen':
        return done(parsed, d.readScreen())
      case 'call_guardian': {
        if (d.simulation) return done(parsed, 'You are in Simulation mode, so I will not place a real call.', false)
        let g: { name: string; phone: string } | null
        try {
          g = await d.getGuardian()
        } catch {
          return done(parsed, 'I could not load your guardian details, so I cannot place a call.', false)
        }
        if (!g || !g.phone.trim()) return done(parsed, 'You have not saved a guardian phone number. Add one in your profile first.', false)
        return ask({ kind: 'call', name: g.name || 'your guardian', phone: g.phone.trim() }, `Call ${g.name || 'your guardian'} on ${g.phone.trim()}? Say yes or no.`, parsed)
      }
      case 'sos': {
        if (!d.sos.live) {
          d.sos.requestSend()
          return done(parsed, 'Simulation mode: opening the emergency practice run. No real alert will be sent.')
        }
        if (!d.sos.ready) {
          d.sos.requestSend()
          return done(parsed, 'Emergency alerts are not set up yet: add a guardian email first. Opening the SOS page. Nothing was sent.', false)
        }
        d.sos.requestSend()
        // The dialog is the question: no Yes/No buttons of our own that could go stale.
        return done(parsed, 'Opening emergency alert confirmation. Say confirm or tap Send now.')
      }
      case 'go_back':
        if (!d.canGoBack()) return done(parsed, 'There is nothing to go back to.', false)
        d.navigate(-1)
        return done(parsed, 'Going back.')
      case 'stop_listening':
        return done(parsed, 'Stopped listening.', true, { stopListening: true })
      case 'help':
        return done(parsed, 'You can say: open dashboard, start camera, where am I, take me to a place, check device status, call guardian, or emergency SOS. The full list is on screen.', true, { showHelp: true })
      case 'yes':
        if (d.sos.confirmOpen()) return done(parsed, 'To send the alert, say confirm, or tap Send now.', false)
        return done(parsed, 'There is nothing to confirm.', false)
      case 'confirm':
        if (d.sos.confirmOpen()) {
          d.sos.confirm()
          return done(parsed, 'Sending the emergency alert now. The dialog will show whether it was delivered.')
        }
        return done(parsed, 'There is nothing to confirm.', false)
      case 'no':
      case 'cancel':
        if (d.sos.confirmOpen()) {
          d.sos.cancel()
          return done(parsed, 'Emergency alert cancelled. Nothing was sent.')
        }
        return done(parsed, 'Okay. There is nothing to cancel.')
      case 'choose':
        return done(parsed, 'There is nothing to choose from right now.', false)
      default:
        return done(parsed, unknownText(intent), false)
    }
  }

  async function execute(text: string): Promise<Reply> {
    const heard = text.trim()
    const parsed = parseCommand(heard)
    const p = pending
    if (p) {
      const intent = parsed?.intent
      if (intent === 'no' || intent === 'cancel') {
        clearPending()
        return done(parsed, 'Cancelled.')
      }
      if (p.kind === 'choose') {
        if (intent === 'choose') {
          const idx = (parsed!.args.index ?? 0) - 1
          const place = p.options[idx]
          if (!place) return { ...ask(p, `There are only ${p.options.length} options. Say a number from 1 to ${p.options.length}, or say cancel.`, parsed), choices: p.options.length }
          return ask({ kind: 'nav', place }, `Start navigation to ${shortLabel(place.label)}? Say yes or no.`, parsed)
        }
        if (intent === 'yes' || intent === 'confirm') return { ...ask(p, 'Please say the number of the place, or say cancel.', parsed), choices: p.options.length }
      } else if (p.kind === 'nav' || p.kind === 'call') {
        if (intent === 'yes' || intent === 'confirm') {
          clearPending()
          if (p.kind === 'nav') return startNavigation(parsed, p.place)
          const phone = p.phone.replace(/[^\d+]/g, '')
          if (phone.replace(/\D/g, '').length < 3) return done(parsed, `The saved guardian number "${p.phone}" does not look like a phone number, so I did not call.`, false)
          getDeps().dial(`tel:${phone}`)
          return done(parsed, `Opening the phone dialer for ${p.name}. Whether the call goes through depends on your device.`)
        }
      } else if (p.kind === 'where' && heard && parsed?.intent === 'navigate_to' && !parsed.args.destination) {
        return ask(p, 'Where would you like to go? Say the name of a place in Coimbatore.', parsed)
      } else if (p.kind === 'where' && heard && (!parsed || parsed.intent === 'navigate_to')) {
        clearPending()
        const dest = parsed?.args.destination ?? heard
        return findDestination(parsed ?? { intent: 'navigate_to', args: { destination: dest }, confidence: 0.7 }, dest)
      }
      // Anything else is unrelated to the question: drop the question and carry on.
      clearPending()
      if (!parsed) return done(null, `Cancelled. ${unknownText(heard)}`, false, { showHelp: true })
    }
    if (!parsed) return done(null, unknownText(heard), false, { showHelp: true })
    try {
      return await dispatch(parsed)
    } catch (err) {
      const why = err instanceof Error && err.message ? ` ${err.message}` : ''
      return done(parsed, `That did not work.${why}`, false)
    }
  }

  return {
    execute,
    hasPending: () => pending !== null,
    cancelPending: clearPending,
  }
}

export type Executor = ReturnType<typeof createExecutor>
