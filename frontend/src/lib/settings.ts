import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { applyAccessibility, type AccessibilityPrefs, type TextSize } from './a11y'

export type ServerTextSize = 'md' | 'lg' | 'xl'

export interface Settings {
  camera: { deviceId: string | null; preferences: Record<string, unknown> }
  hardware: { deviceIp: string; pollingIntervalMs: number; sensorSettings: Record<string, unknown> }
  ai: { confidenceThreshold: number; riskSettings: Record<string, unknown>; openaiVisionEnabled: boolean }
  voice: { enabled: boolean; rate: number; voiceName: string | null; feedback: boolean }
  accessibility: { textSize: ServerTextSize; highContrast: boolean; largeButtons: boolean }
  emergency: { contact: string }
}

export type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> }

export const SETTINGS_KEY = ['settings'] as const

const A11Y_CACHE_KEY = 'thirdeye.a11y'

/** The server stores "md"; the CSS layer calls the default size "normal". */
export function toTextSize(s: ServerTextSize): TextSize {
  return s === 'md' ? 'normal' : s
}
export function toServerTextSize(s: TextSize): ServerTextSize {
  return s === 'normal' ? 'md' : s
}

export function toPrefs(a: Settings['accessibility']): AccessibilityPrefs {
  return { textSize: toTextSize(a.textSize), highContrast: a.highContrast, largeButtons: a.largeButtons }
}

/** Accessibility preferences are the only thing cached locally, so the login page can honour them. */
export function cacheAccessibility(prefs: AccessibilityPrefs): void {
  try {
    localStorage.setItem(A11Y_CACHE_KEY, JSON.stringify(prefs))
  } catch {
    /* cache is optional */
  }
}

export function readCachedAccessibility(): Partial<AccessibilityPrefs> {
  try {
    const raw = localStorage.getItem(A11Y_CACHE_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as Partial<AccessibilityPrefs>
    return {
      textSize: p.textSize === 'lg' || p.textSize === 'xl' ? p.textSize : 'normal',
      highContrast: p.highContrast === true,
      largeButtons: p.largeButtons === true,
    }
  } catch {
    return {}
  }
}

/** Shared settings document. Later features (camera, voice, AI) read it through this hook. */
export function useSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.get<Settings>('/settings'), staleTime: 30_000 })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.put<Settings>('/settings', patch),
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data)
      const prefs = toPrefs(data.accessibility)
      cacheAccessibility(prefs)
      applyAccessibility(prefs)
    },
  })
}

export function useEmailStatus() {
  return useQuery({ queryKey: ['email-status'], queryFn: () => api.get<{ configured: boolean }>('/settings/email-status') })
}
