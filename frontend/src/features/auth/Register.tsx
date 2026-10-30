import { UserPlus } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Input } from '../../design'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AuthLayout } from './AuthLayout'
import { ErrorBanner } from './FormBanner'
import { stripEmpty, validateConfirm, validateEmail, validateName, validatePassword, validatePhone } from './validation'

type Field = 'name' | 'email' | 'phone' | 'password' | 'confirm'

export function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<Field, string>>({ name: '', email: '', phone: '', password: '', confirm: '' })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const bind = (field: Field) => ({
    value: values[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [field]: e.target.value })),
    error: errors[field],
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found = stripEmpty({
      name: validateName(values.name),
      email: validateEmail(values.email),
      phone: validatePhone(values.phone),
      password: validatePassword(values.password),
      confirm: validateConfirm(values.password, values.confirm),
    })
    setErrors(found)
    if (Object.keys(found).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    setSubmitting(true)
    try {
      await register({
        name: values.name.trim(),
        email: values.email.trim(),
        phone: values.phone.replace(/[\s-]/g, ''),
        password: values.password,
      })
      navigate('/portal', { replace: true })
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="It takes a minute. You will choose how to use Third Eye next."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-primary underline underline-offset-4">
            Log in
          </Link>
        </>
      }
    >
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
        {serverError && <ErrorBanner message={serverError} />}
        <Input label="Full name" autoComplete="name" {...bind('name')} />
        <Input label="Email" type="email" autoComplete="email" inputMode="email" {...bind('email')} />
        <Input
          label="Phone number"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          hint="7 to 15 digits. You can start with +, for example +91."
          {...bind('phone')}
        />
        <Input
          label="Password"
          type="password"
          revealable
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a digit."
          {...bind('password')}
        />
        <Input label="Confirm password" type="password" revealable autoComplete="new-password" {...bind('confirm')} />
        <Button type="submit" fullWidth loading={submitting} leftIcon={<UserPlus className="h-5 w-5" aria-hidden="true" />}>
          {submitting ? 'Creating account' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  )
}
