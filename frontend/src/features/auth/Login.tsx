import { LogIn } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button, Input } from '../../design'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AuthLayout } from './AuthLayout'
import { ErrorBanner } from './FormBanner'
import { stripEmpty, validateEmail } from './validation'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found = stripEmpty({
      email: validateEmail(email),
      password: password ? undefined : 'Enter your password.',
    })
    setErrors(found)
    if (Object.keys(found).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    setSubmitting(true)
    try {
      await login(email.trim(), password, remember)
      // Return to the page that sent the user here (only same-app paths), otherwise pick a portal.
      const from = (location.state as { from?: unknown } | null)?.from
      navigate(typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/portal', { replace: true })
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to continue to your Third Eye dashboard."
      footer={
        <>
          New to Third Eye?{' '}
          <Link to="/register" className="font-bold text-primary underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
        {serverError && <ErrorBanner message={serverError} />}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Input
          label="Password"
          type="password"
          revealable
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <label className="flex min-h-[var(--control-h)] cursor-pointer items-center gap-3 text-base font-medium text-ink">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-5 w-5 accent-[var(--primary)]"
            />
            Remember me
          </label>
          <Link
            to="/forgot-password"
            className="flex min-h-[var(--control-h)] items-center font-bold text-primary underline underline-offset-4"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" fullWidth loading={submitting} leftIcon={<LogIn className="h-5 w-5" aria-hidden="true" />}>
          {submitting ? 'Logging in' : 'Log in'}
        </Button>
      </form>
    </AuthLayout>
  )
}
