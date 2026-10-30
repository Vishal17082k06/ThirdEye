// Mirrors the backend rules in backend/app/schemas.py so users see problems before the round trip.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9]{7,15}$/

export function validateName(value: string): string | undefined {
  const v = value.trim()
  if (!v) return 'Enter your full name.'
  if (v.length > 120) return 'Name must be 120 characters or fewer.'
  return undefined
}

export function validateEmail(value: string): string | undefined {
  const v = value.trim()
  if (!v) return 'Enter your email address.'
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address, for example name@example.com.'
  return undefined
}

export function validatePhone(value: string): string | undefined {
  const cleaned = value.replace(/[\s-]/g, '')
  if (!cleaned) return 'Enter your phone number.'
  if (!PHONE_RE.test(cleaned)) return 'Phone must have 7 to 15 digits, optionally starting with +.'
  return undefined
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Enter a password.'
  if (value.length < 8) return 'Password must be at least 8 characters long.'
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return 'Password must contain at least one letter and one digit.'
  // bcrypt only reads the first 72 bytes, so the backend rejects longer passwords.
  if (new TextEncoder().encode(value).length > 72) return 'Password must be at most 72 characters long.'
  return undefined
}

export function validateConfirm(password: string, confirm: string): string | undefined {
  if (!confirm) return 'Re-enter your password.'
  if (password !== confirm) return 'Passwords do not match.'
  return undefined
}

export function stripEmpty<T extends Record<string, string | undefined>>(errors: T): Partial<T> {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as Partial<T>
}
