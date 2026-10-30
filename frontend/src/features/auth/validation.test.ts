import { describe, expect, it } from 'vitest'
import { validateName } from './validation'

describe('validateName', () => {
  it('requires a name', () => {
    expect(validateName('   ')).toBeDefined()
  })
  it('accepts 120 characters and rejects 121 (backend limit)', () => {
    expect(validateName('a'.repeat(120))).toBeUndefined()
    expect(validateName('a'.repeat(121))).toMatch(/120/)
  })
})
