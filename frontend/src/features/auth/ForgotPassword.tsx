import { Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, Input } from '../../design'
import { api, ApiError } from '../../lib/api'
import { AuthLayout } from './AuthLayout'
import { ErrorBanner, SuccessBanner } from './FormBanner'
import { validateEmail } from './validation'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const problem = validateEmail(email)
    setError(problem)
    if (problem) return
    setSubmitting(true)
    try {
      const res = await api.post<{ message?: string }>('/auth/forgot-password', { email: email.trim() })
      // The server answers identically whether or not the account exists, so we show its message as-is.
      setConfirmation(res?.message ?? 'If an account exists for that email, a reset link has been sent.')
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email you registered with and we will send reset instructions if an account exists."
      footer={
        <Link to="/login" className="font-bold text-primary underline underline-offset-4">
          Back to log in
        </Link>
      }
    >
      {confirmation ? (
        <SuccessBanner message={confirmation} />
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {serverError && <ErrorBanner message={serverError} />}
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
          />
          <Button type="submit" fullWidth loading={submitting} leftIcon={<Send className="h-5 w-5" aria-hidden="true" />}>
            {submitting ? 'Sending' : 'Send reset instructions'}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
