/**
 * Pure command parsing for the voice assistant. No browser APIs here, so every phrase is unit-testable.
 *
 * Matching is deliberately strict: a transcript must match a whole phrase (after normalising and removing filler
 * such as "hey third eye" or "please"). "start camping" therefore never means "start camera", and a lone word like
 * "dashboard" does nothing. A wrong guess is worse than asking again, especially for SOS and calling.
 */

export type Intent =
  | 'open_dashboard'
  | 'open_ai'
  | 'start_camera'
  | 'stop_camera'
  | 'start_detection'
  | 'stop_detection'
  | 'open_navigation'
  | 'where_am_i'
  | 'navigate_to'
  | 'mode_walk'
  | 'mode_car'
  | 'open_rides'
  | 'device_status'
  | 'read_screen'
  | 'call_guardian'
  | 'sos'
  | 'go_back'
  | 'stop_listening'
  | 'cancel'
  | 'yes'
  | 'no'
  | 'choose'
  | 'help'

export interface CommandArgs {
  /** navigate_to: the place name. Absent means "take me to a destination" with no name: ask where. */
  destination?: string
  /** choose: 1-based option number. */
  index?: number
}

export interface ParsedCommand {
  intent: Intent
  args: CommandArgs
  /** 1 = exact phrase, 0.9 = matched after removing filler, 0.8 = destination taken from free text. */
  confidence: number
}

/** Lower-case, drop apostrophes, turn any other punctuation into spaces, collapse spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const LEADING_FILLER = [
  /^(hey|hi|hello|ok|okay)\s+(third\s?eye|thirdeye|third\s+i|assistant)\b\s*/,
  /^(third\s?eye|thirdeye)\b\s*/,
  /^please\s+/,
  /^(can|could|would|will)\s+you\s+/,
  /^(i\s+want\s+you\s+to|i\s+want\s+to|i\s+would\s+like\s+to|id\s+like\s+to|i\s+need\s+to|lets)\s+/,
  /^(just|kindly)\s+/,
]
const TRAILING_FILLER = [/\s+please$/, /\s+for\s+me$/, /\s+now$/, /\s+thanks$/, /\s+thank\s+you$/]

/** Returns the core phrase and whether any filler was removed. */
export function stripFiller(norm: string): { core: string; stripped: boolean } {
  let s = norm
  let stripped = false
  for (let changed = true; changed; ) {
    changed = false
    for (const re of [...LEADING_FILLER, ...TRAILING_FILLER]) {
      const next = s.replace(re, '')
      if (next !== s && next.length > 0) {
        s = next
        changed = true
        stripped = true
      }
    }
  }
  return { core: s, stripped }
}

const OPEN = '(?:open|show|go to|take me to|navigate to|switch to)'
const THE = '(?:the |my )?'

interface Rule {
  intent: Intent
  re: RegExp
}

/** Page and feature commands come before free-text destinations ("go to navigation" is a page, not a place). */
const RULES: Rule[] = [
  // Safety-critical: exact phrases only.
  {
    intent: 'sos',
    re: /^(?:emergency|sos|emergency sos|(?:open |send |trigger |start |activate |call )(?:an |the )?(?:emergency sos|emergency alert|emergency|sos|sos alert)|i need help|help me|i am in danger|im in danger)$/,
  },
  { intent: 'call_guardian', re: /^(?:call|phone|ring|dial|contact)\s+(?:my |the )?guardian$/ },
  {
    intent: 'stop_listening',
    re: /^(?:(?:stop|quit|end|pause) (?:listening|voice assistant|voice commands)|mic off|microphone off|turn off (?:the )?(?:mic|microphone))$/,
  },
  { intent: 'cancel', re: /^(?:cancel|never mind|nevermind|forget it|abort|stop that|dont|do not)$/ },
  {
    intent: 'yes',
    re: /^(?:yes|yeah|yep|yup|confirm|confirmed|sure|do it|go ahead|send|send it|affirmative|proceed|yes confirm|yes send|yes call)$/,
  },
  { intent: 'no', re: /^(?:no|nope|nah|negative|no thanks|dont do it|do not do it)$/ },
  { intent: 'help', re: /^(?:help|what can i say|what can you do|show commands|list commands|show help|voice help)$/ },

  { intent: 'open_dashboard', re: new RegExp(`^${OPEN} ${THE}(?:dashboard|home page|home)$`) },
  { intent: 'open_ai', re: new RegExp(`^${OPEN} ${THE}(?:ai|a i)(?: assistance| assistant| page| assist)?$`) },
  { intent: 'start_camera', re: new RegExp(`^(?:start|turn on|switch on|enable|open) ${THE}camera$`) },
  { intent: 'stop_camera', re: new RegExp(`^(?:stop|turn off|switch off|disable|close) ${THE}camera$`) },
  {
    intent: 'start_detection',
    re: /^(?:(?:start|begin|turn on|enable|run) (?:the )?(?:obstacle detection|obstacle detecting|detection)|(?:start|begin) detecting(?: obstacles)?|detect (?:the )?obstacles)$/,
  },
  {
    intent: 'stop_detection',
    re: /^(?:(?:stop|end|turn off|disable|pause) (?:the )?(?:obstacle detection|obstacle detecting|detection)|stop detecting(?: obstacles)?)$/,
  },
  { intent: 'open_navigation', re: new RegExp(`^${OPEN} ${THE}navigation(?: page)?$`) },
  {
    intent: 'where_am_i',
    re: /^(?:where am i(?: right| currently)?|(?:what is|whats) my (?:current )?(?:location|position)|tell me where i am)$/,
  },
  {
    intent: 'mode_walk',
    re: /^(?:(?:walking|walk|foot|pedestrian) mode|walk|walking|(?:switch to|change to|use|set|enable) (?:the )?(?:walking|walk|foot)(?: mode)?)$/,
  },
  {
    intent: 'mode_car',
    re: /^(?:(?:car|driving|drive) mode|drive|driving|(?:switch to|change to|use|set|enable) (?:the )?(?:car|driving|drive)(?: mode)?)$/,
  },
  {
    intent: 'open_rides',
    re: new RegExp(
      `^(?:${OPEN} ${THE}(?:book a ride|book ride|rides|ride booking|book a cab|cab booking|book a taxi)(?: page)?|book (?:me )?(?:a |an )?(?:ride|cab|taxi))$`,
    ),
  },
  {
    intent: 'device_status',
    re: /^(?:(?:check|show|read|tell me|what is|whats) (?:the |my )?(?:device|devices) status|devices? status|check (?:the |my )?devices?)$/,
  },
  {
    intent: 'read_screen',
    re: /^(?:read (?:the |this |my )?(?:screen|page)(?: aloud| out loud| out)?|(?:what is|whats) on (?:the |my )?screen)$/,
  },
  { intent: 'go_back', re: /^(?:go back(?: a page| one page)?|back|previous page|navigate back)$/ },
]

const CHOICE_WORDS: Record<string, number> = {
  '1': 1, one: 1, first: 1, '1st': 1,
  '2': 2, two: 2, second: 2, '2nd': 2,
  '3': 3, three: 3, third: 3, '3rd': 3,
}
const CHOICE_RE = /^(?:(?:the |number |option |choice |result )+)?(1|one|first|1st|2|two|second|2nd|3|three|third|3rd)(?: one| option| result| number)?$/

/** Words that mean "a destination" without naming one. */
const GENERIC_PLACE = /^(?:a |the |my |some |any )?(?:destination|place|location|somewhere|somewhere else|anywhere|there)$/

const GO_TO =
  /^(?:take me to|navigate me to|navigate to|go to|directions to|guide me to|drive me to|walk me to|i want to go to|show me the way to|lead me to)(?: (.+))?$/

function destinationCommand(core: string, stripped: boolean): ParsedCommand | null {
  const m = GO_TO.exec(core)
  if (!m) return null
  let dest = (m[1] ?? '').trim()
  if (dest && GENERIC_PLACE.test(dest)) dest = ''
  dest = dest.replace(/^the (?=.{3,})/, '')
  if (dest.length === 1) return null
  return { intent: 'navigate_to', args: dest ? { destination: dest } : {}, confidence: dest ? 0.8 : stripped ? 0.9 : 1 }
}

/** Turns what the person said (or typed) into a command, or null when it is not a command we know. */
export function parseCommand(transcript: string): ParsedCommand | null {
  const norm = normalize(transcript ?? '')
  if (!norm) return null
  const { core, stripped } = stripFiller(norm)
  const conf = stripped ? 0.9 : 1

  for (const { intent, re } of RULES) {
    if (re.test(core)) return { intent, args: {}, confidence: conf }
  }
  const choice = CHOICE_RE.exec(core)
  if (choice) return { intent: 'choose', args: { index: CHOICE_WORDS[choice[1]] }, confidence: conf }
  return destinationCommand(core, stripped)
}

/** Help list shown in the panel: every supported command with an example phrase. */
export const COMMAND_HELP: Array<{ label: string; example: string }> = [
  { label: 'Open the dashboard', example: 'Open dashboard' },
  { label: 'Open AI Assistance', example: 'Open AI assistance' },
  { label: 'Start or stop the camera', example: 'Start camera / Stop camera' },
  { label: 'Start or stop obstacle detection', example: 'Start obstacle detection / Stop obstacle detection' },
  { label: 'Open Navigation', example: 'Open navigation' },
  { label: 'Say where you are', example: 'Where am I?' },
  { label: 'Navigate to a place in Coimbatore', example: 'Take me to Gandhipuram' },
  { label: 'Change travel mode', example: 'Walking mode / Car mode' },
  { label: 'Open Book a Ride', example: 'Open book a ride' },
  { label: 'Read device status', example: 'Check device status' },
  { label: 'Read the current screen', example: 'Read screen' },
  { label: 'Call your guardian (asks first)', example: 'Call guardian' },
  { label: 'Emergency SOS (asks first)', example: 'Emergency SOS' },
  { label: 'Go back', example: 'Go back' },
  { label: 'Stop listening', example: 'Stop listening' },
  { label: 'Answer a question', example: 'Yes / No / Cancel / Number two' },
]
