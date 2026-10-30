import { createContext, useContext } from 'react'
import type { RecognitionStatus } from './useSpeechRecognition'

export interface VoiceEntry {
  id: number
  /** What was heard or typed. */
  heard: string
  /** The command it was interpreted as, or null when it was not understood. */
  interpreted: string | null
  /** What the assistant answered (shown and, when enabled, spoken). */
  response: string
  ok: boolean
  via: 'voice' | 'typed' | 'button'
}

export interface VoiceApi {
  open: boolean
  setOpen: (open: boolean) => void
  /** Settings > Voice > "enabled". When off, recognition and spoken replies are off but typed commands work. */
  enabled: boolean
  status: RecognitionStatus
  listening: boolean
  /** Interim transcript while the person is speaking. */
  interim: string
  error: string | null
  busy: boolean
  last: VoiceEntry | null
  history: VoiceEntry[]
  /** The assistant asked a question; `choices` is the number of numbered options when it is a pick-a-place question. */
  awaiting: { choices: number } | null
  showHelp: boolean
  setShowHelp: (show: boolean) => void
  toggleListening: () => void
  /** Run a typed command or a button answer. */
  runCommand: (text: string, via?: 'typed' | 'button') => Promise<void>
}

export const SHORTCUT_LABEL = 'Alt+Shift+V'

export const VoiceContext = createContext<VoiceApi | null>(null)

export function useVoiceAssistant(): VoiceApi {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoiceAssistant must be used inside <VoiceProvider>')
  return ctx
}

export function useOptionalVoiceAssistant(): VoiceApi | null {
  return useContext(VoiceContext)
}
