import { afterEach, describe, expect, it } from 'vitest'
import { applyAccessibility } from './a11y'

afterEach(() => applyAccessibility({}))

describe('applyAccessibility', () => {
  it('sets data attributes on <html>', () => {
    applyAccessibility({ highContrast: true, textSize: 'xl', largeButtons: true })
    const html = document.documentElement
    expect(html.dataset.contrast).toBe('high')
    expect(html.dataset.text).toBe('xl')
    expect(html.dataset.buttons).toBe('large')
  })

  it('removes attributes when preferences return to defaults', () => {
    applyAccessibility({ highContrast: true, textSize: 'lg', largeButtons: true })
    applyAccessibility({ highContrast: false, textSize: 'normal', largeButtons: false })
    const html = document.documentElement
    expect(html.hasAttribute('data-contrast')).toBe(false)
    expect(html.hasAttribute('data-text')).toBe(false)
    expect(html.hasAttribute('data-buttons')).toBe(false)
  })

  it('treats missing fields as defaults', () => {
    applyAccessibility({ textSize: 'lg' })
    expect(document.documentElement.dataset.text).toBe('lg')
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false)
  })
})
