export type TextSize = 'normal' | 'lg' | 'xl'

export interface AccessibilityPrefs {
  textSize: TextSize
  highContrast: boolean
  largeButtons: boolean
}

export const DEFAULT_ACCESSIBILITY: AccessibilityPrefs = {
  textSize: 'normal',
  highContrast: false,
  largeButtons: false,
}

/**
 * Reflects accessibility preferences as data-* attributes on <html>.
 * The CSS tokens in index.css respond to those attributes, so no component
 * needs to know about them. Default values remove the attribute entirely.
 */
export function applyAccessibility(
  prefs: Partial<AccessibilityPrefs>,
  root: HTMLElement = document.documentElement,
): void {
  const p = { ...DEFAULT_ACCESSIBILITY, ...prefs }
  const set = (name: string, value: string | null) => {
    if (value === null) root.removeAttribute(name)
    else root.setAttribute(name, value)
  }
  set('data-contrast', p.highContrast ? 'high' : null)
  set('data-text', p.textSize === 'normal' ? null : p.textSize)
  set('data-buttons', p.largeButtons ? 'large' : null)
}
