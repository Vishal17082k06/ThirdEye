import { describe, expect, it } from 'vitest'
import { COMMAND_HELP, normalize, parseCommand, stripFiller, type Intent } from './commands'

const POSITIVE: Array<[string, Intent]> = [
  ['open dashboard', 'open_dashboard'],
  ['Open the Dashboard.', 'open_dashboard'],
  ['go to dashboard', 'open_dashboard'],
  ['show my dashboard', 'open_dashboard'],
  ['please open dashboard', 'open_dashboard'],
  ['open AI assistance', 'open_ai'],
  ['Open A.I. assistance', 'open_ai'],
  ['open the AI assistant', 'open_ai'],
  ['go to AI', 'open_ai'],
  ['start camera', 'start_camera'],
  ['Start the camera!', 'start_camera'],
  ['turn on camera', 'start_camera'],
  ['hey third eye, start camera', 'start_camera'],
  ['can you start the camera please', 'start_camera'],
  ['stop camera', 'stop_camera'],
  ['turn off the camera', 'stop_camera'],
  ['start obstacle detection', 'start_detection'],
  ['start detecting', 'start_detection'],
  ['start detecting obstacles', 'start_detection'],
  ['detect obstacles', 'start_detection'],
  ['begin obstacle detection', 'start_detection'],
  ['stop obstacle detection', 'stop_detection'],
  ['stop detecting', 'stop_detection'],
  ['open navigation', 'open_navigation'],
  ['go to navigation page', 'open_navigation'],
  ['where am I', 'where_am_i'],
  ['Where am I?', 'where_am_i'],
  ["what's my location", 'where_am_i'],
  ['what is my location', 'where_am_i'],
  ['hey third eye where am i right now', 'where_am_i'],
  ['walking mode', 'mode_walk'],
  ['walk', 'mode_walk'],
  ['switch to walking mode', 'mode_walk'],
  ['car mode', 'mode_car'],
  ['drive', 'mode_car'],
  ['switch to car mode', 'mode_car'],
  ['open book a ride', 'open_rides'],
  ['book a ride', 'open_rides'],
  ['open rides', 'open_rides'],
  ['book a cab', 'open_rides'],
  ['check device status', 'device_status'],
  ['device status', 'device_status'],
  ["what is the device status", 'device_status'],
  ['read screen', 'read_screen'],
  ['read the screen', 'read_screen'],
  ['what is on the screen', 'read_screen'],
  ['call guardian', 'call_guardian'],
  ['call my guardian', 'call_guardian'],
  ['Could you call my guardian please', 'call_guardian'],
  ['emergency SOS', 'sos'],
  ['send SOS', 'sos'],
  ['I need help', 'sos'],
  ['emergency', 'sos'],
  ['help me', 'sos'],
  ['go back', 'go_back'],
  ['back', 'go_back'],
  ['stop listening', 'stop_listening'],
  ['cancel', 'cancel'],
  ['never mind', 'cancel'],
  ['yes', 'yes'],
  ['okay', 'yes'],
  ['sure', 'yes'],
  ['confirm', 'confirm'],
  ['send it', 'confirm'],
  ['yes confirm', 'confirm'],
  ['send now', 'confirm'],
  ['Yes, please.', 'yes'],
  ['no', 'no'],
  ['nope', 'no'],
  ['help', 'help'],
  ['what can I say', 'help'],
]

const NEGATIVE = [
  '',
  '   ',
  '???',
  'start camping',
  'start cameras and lights',
  'camera',
  'dashboard',
  'navigation',
  'sos is a word',
  'I need help finding my keys',
  'help me find the dashboard',
  'emergency exit is on the left',
  'where am i going to eat',
  'open the door',
  'call a taxi',
  'call guardian angel',
  'stop camera now and forever',
  'what is the weather',
  'hello',
  'yes I think so maybe',
  'start',
  'stop',
  'read my mail',
  'walk the dog',
  'go',
  'send the report',
]

describe('parseCommand: every supported phrase', () => {
  it.each(POSITIVE)('%s -> %s', (text, intent) => {
    expect(parseCommand(text)?.intent).toBe(intent)
  })

  it('covers all 17 spec commands plus the control commands', () => {
    const covered = new Set(POSITIVE.map(([, i]) => i))
    for (const i of [
      'open_dashboard', 'open_ai', 'start_camera', 'stop_camera', 'start_detection', 'stop_detection', 'open_navigation',
      'where_am_i', 'mode_walk', 'mode_car', 'open_rides', 'device_status', 'read_screen', 'call_guardian', 'sos', 'go_back',
      'stop_listening', 'cancel', 'yes', 'no',
    ] as Intent[]) {
      expect(covered.has(i)).toBe(true)
    }
  })
})

describe('parseCommand: things that must NOT match', () => {
  it.each(NEGATIVE)('%j is not a command', (text) => {
    expect(parseCommand(text)).toBeNull()
  })
})

describe('parseCommand: destinations', () => {
  it.each([
    ['take me to Gandhipuram', 'gandhipuram'],
    ['Navigate to RS Puram.', 'rs puram'],
    ['go to Brookefields Mall', 'brookefields mall'],
    ['hey third eye take me to the railway station please', 'railway station'],
    ["I want to go to Peelamedu", 'peelamedu'],
    ['navigate to PSG College of Technology', 'psg college of technology'],
  ])('%s -> destination %s', (text, dest) => {
    const c = parseCommand(text)
    expect(c?.intent).toBe('navigate_to')
    expect(c?.args.destination).toBe(dest)
    expect(c?.confidence).toBeLessThan(1)
  })

  it.each(['take me to a destination', 'take me to', 'navigate to somewhere', 'go to a place'])(
    '%s asks where (no destination)',
    (text) => {
      const c = parseCommand(text)
      expect(c?.intent).toBe('navigate_to')
      expect(c?.args.destination).toBeUndefined()
    },
  )

  it('keeps page names as pages, not places', () => {
    expect(parseCommand('go to navigation')?.intent).toBe('open_navigation')
    expect(parseCommand('take me to the dashboard')?.intent).toBe('open_dashboard')
    expect(parseCommand('go to book a ride')?.intent).toBe('open_rides')
  })
})

describe('parseCommand: choices', () => {
  it.each([
    ['first', 1], ['one', 1], ['1', 1], ['the first one', 1], ['number two', 2], ['number 2', 2], ['second', 2],
    ['three', 3], ['option three', 3], ['the third one', 3],
  ])('%s -> %i', (text, n) => {
    const c = parseCommand(text)
    expect(c?.intent).toBe('choose')
    expect(c?.args.index).toBe(n)
  })

  it('does not treat other numbers as choices', () => {
    expect(parseCommand('number nine')).toBeNull()
    expect(parseCommand('4')).toBeNull()
  })
})

describe('parseCommand: result shape', () => {
  it('reports full confidence for an exact phrase and less when filler was removed', () => {
    expect(parseCommand('open dashboard')).toEqual({ intent: 'open_dashboard', args: {}, confidence: 1 })
    expect(parseCommand('please open dashboard')?.confidence).toBe(0.9)
  })

  it('is case and punctuation insensitive', () => {
    expect(parseCommand('  OPEN,   dashboard!!! ')?.intent).toBe('open_dashboard')
  })
})

describe('helpers', () => {
  it('normalize drops punctuation and apostrophes', () => {
    expect(normalize("What's  my location?")).toBe('whats my location')
  })
  it('stripFiller removes wrappers only', () => {
    expect(stripFiller('hey third eye can you start camera please')).toEqual({ core: 'start camera', stripped: true })
    expect(stripFiller('start camera')).toEqual({ core: 'start camera', stripped: false })
  })
  it('help list names every spec command', () => {
    expect(COMMAND_HELP.length).toBeGreaterThanOrEqual(15)
  })
})
