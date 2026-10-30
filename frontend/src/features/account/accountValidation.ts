import { validateEmail, validateName, validatePassword, validatePhone } from '../auth/validation'

export { validateEmail, validateName, validatePassword, validatePhone }

/** Age is optional; when given it must be a whole number from 1 to 120 (same as the backend). */
export function validateAge(value: string): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  if (!/^\d+$/.test(v)) return 'Age must be a whole number.'
  const n = Number(v)
  if (n < 1 || n > 120) return 'Age must be between 1 and 120.'
  return undefined
}

export function validateRequired(label: string, value: string, max = 120): string | undefined {
  const v = value.trim()
  if (!v) return `Enter ${label}.`
  if (v.length > max) return `${label[0].toUpperCase()}${label.slice(1)} must be ${max} characters or fewer.`
  return undefined
}

export function validateCurrentPassword(value: string): string | undefined {
  return value ? undefined : 'Enter your current password.'
}

export function validateNewPassword(value: string, current: string): string | undefined {
  const base = validatePassword(value)
  if (base) return base
  if (value === current) return 'New password must differ from the current password.'
  return undefined
}
