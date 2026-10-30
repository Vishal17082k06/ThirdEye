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
  if (cm <= 50) return { risk: 'critical', label: 'Very close', warning: 'Simulated: stop. Obstacle very close.', speak: true }
  if (cm <= 100) return { risk: 'high', label: 'Close', warning: 'Simulated: obstacle close ahead.', speak: true }
  if (cm <= 200) return { risk: 'medium', label: 'Near', warning: 'Simulated: obstacle ahead.', speak: true }
  return { risk: 'low', label: 'Far', warning: 'No simulated reading closer than 2 metres.', speak: false }
}
