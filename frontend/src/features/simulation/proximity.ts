import type { Risk } from '../../hooks/useSpeech'

export const MIN_CM = 10
export const MAX_CM = 400

export interface Band {
  risk: Risk
  label: string
  warning: string
  /** Whether this band is worth a spoken warning. */
  speak: boolean
}

/** Maps a simulated distance to a proximity band and spoken warning. */
export function proximityBand(cm: number): Band {
  if (cm <= 50) return { risk: 'critical', label: 'Very close', warning: 'Stop. Obstacle very close.', speak: true }
  if (cm <= 100) return { risk: 'high', label: 'Close', warning: 'Obstacle close ahead.', speak: true }
  if (cm <= 200) return { risk: 'medium', label: 'Near', warning: 'Obstacle ahead.', speak: true }
  return { risk: 'low', label: 'Far', warning: 'No obstacle within 2 metres in this simulated reading.', speak: false }
}
