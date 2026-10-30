import { KeyRound, Save, ShieldCheck, UserRound } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Card, CardHeader, Input, Select, Spinner, useToast } from '../../design'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { ErrorBanner } from '../auth/FormBanner'
import { stripEmpty, validateConfirm } from '../auth/validation'
import {
  validateAge,
  validateCurrentPassword,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePhone,
  validateRequired,
} from './accountValidation'
import { useChangePassword, useGuardian, useProfile, useSaveGuardian, useSaveProfile, type Guardian } from './useAccount'

const msg = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')

function LoadState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean
  error: boolean
  onRetry: () => void
  children: ReactNode
}) {
  if (loading) return <Spinner label="Loading" />
  if (error)
    return (
      <div className="space-y-3">
        <ErrorBanner message="Could not load this information." />
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  return <>{children}</>
}

function Footer({ saving, dirty, label }: { saving: boolean; dirty: boolean; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" loading={saving} leftIcon={<Save className="h-5 w-5" aria-hidden="true" />}>
        {saving ? 'Saving' : label}
      </Button>
      {dirty && !saving && <span className="text-sm font-semibold text-warning">Unsaved changes</span>}
    </div>
  )
}

function focusFirstInvalid(form: HTMLFormElement | null) {
  form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

/* ---------- Personal information ---------- */

function ProfileFields({ initial }: { initial: { name: string; age: number | null; email: string; phone: string } }) {
  const save = useSaveProfile()
  const toast = useToast()
  const { updateUser } = useAuth()
  const [values, setValues] = useState({
    name: initial.name,
    age: initial.age === null ? '' : String(initial.age),
    email: initial.email,
    phone: initial.phone,
  })
  const [saved, setSaved] = useState(values)
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const dirty = JSON.stringify(values) !== JSON.stringify(saved)

  const bind = (f: keyof typeof values) => ({
    value: values[f],
    error: errors[f],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [f]: e.target.value })),
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found = stripEmpty({
      name: validateName(values.name),
      age: validateAge(values.age),
      email: validateEmail(values.email),
      phone: validatePhone(values.phone),
    })
    setErrors(found)
    if (Object.keys(found).length) return focusFirstInvalid(formRef.current)
    try {
      const p = await save.mutateAsync({
        name: values.name.trim(),
        age: values.age.trim() ? Number(values.age) : null,
        email: values.email.trim(),
        phone: values.phone.replace(/[\s-]/g, ''),
      })
      const next = { name: p.name, age: p.age === null ? '' : String(p.age), email: p.email, phone: p.phone }
      setValues(next)
      setSaved(next)
      updateUser({ name: p.name, email: p.email, phone: p.phone })
      toast.show({ tone: 'success', title: 'Profile saved' })
    } catch (err) {
      setServerError(msg(err))
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      {serverError && <ErrorBanner message={serverError} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <Input label="Full name" autoComplete="name" {...bind('name')} />
        <Input label="Age" inputMode="numeric" hint="Optional." {...bind('age')} />
        <Input label="Email" type="email" autoComplete="email" inputMode="email" {...bind('email')} />
        <Input
          label="Phone number"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          hint="7 to 15 digits, optionally starting with +."
          {...bind('phone')}
        />
      </div>
      <Footer saving={save.isPending} dirty={dirty} label="Save profile" />
    </form>
  )
}

export function ProfileForm({ id = 'profile' }: { id?: string }) {
  const q = useProfile()
  return (
    <Card as="section" aria-labelledby={`${id}-title`} id={id}>
      <CardHeader
        id={`${id}-title`}
        title="Personal information"
        description="Your name and contact details."
        icon={<UserRound className="h-5 w-5" aria-hidden="true" />}
      />
      <LoadState loading={q.isPending} error={q.isError} onRetry={() => q.refetch()}>
        {q.data && <ProfileFields initial={q.data} />}
      </LoadState>
    </Card>
  )
}

/* ---------- Guardian ---------- */

export const RELATIONSHIPS = ['Parent', 'Spouse or partner', 'Sibling', 'Child', 'Friend', 'Caregiver'] as const
const OTHER = 'Other'
const isKnown = (r: string) => (RELATIONSHIPS as readonly string[]).includes(r)

function toValues(g: Guardian) {
  return {
    name: g.name,
    email: g.email,
    phone: g.phone,
    relSel: !g.relationship ? '' : isKnown(g.relationship) ? g.relationship : OTHER,
    relOther: g.relationship && !isKnown(g.relationship) ? g.relationship : '',
  }
}

function GuardianFields({ initial }: { initial: Guardian }) {
  const save = useSaveGuardian()
  const toast = useToast()
  const [values, setValues] = useState(() => toValues(initial))
  const [saved, setSaved] = useState(values)
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const dirty = JSON.stringify(values) !== JSON.stringify(saved)

  const bind = (f: 'name' | 'email' | 'phone' | 'relOther') => ({
    value: values[f],
    error: errors[f],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [f]: e.target.value })),
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found = stripEmpty({
      name: validateRequired('the guardian name', values.name),
      email: validateEmail(values.email),
      phone: validatePhone(values.phone),
      relSel: values.relSel ? undefined : 'Choose the relationship.',
      relOther: values.relSel === OTHER ? validateRequired('the relationship', values.relOther, 60) : undefined,
    })
    setErrors(found)
    if (Object.keys(found).length) return focusFirstInvalid(formRef.current)
    try {
      const g = await save.mutateAsync({
        name: values.name.trim(),
        email: values.email.trim(),
        phone: values.phone.replace(/[\s-]/g, ''),
        relationship: values.relSel === OTHER ? values.relOther.trim() : values.relSel,
      })
      const next = toValues(g)
      setValues(next)
      setSaved(next)
      toast.show({ tone: 'success', title: 'Guardian saved' })
    } catch (err) {
      setServerError(msg(err))
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      {serverError && <ErrorBanner message={serverError} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <Input label="Guardian name" autoComplete="off" {...bind('name')} />
        <Select
          label="Relationship"
          value={values.relSel}
          error={errors.relSel}
          onChange={(e) => setValues((v) => ({ ...v, relSel: e.target.value }))}
        >
          <option value="">Choose one</option>
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value={OTHER}>{OTHER}</option>
        </Select>
        {values.relSel === OTHER && <Input label="Describe the relationship" {...bind('relOther')} />}
        <Input
          label="Guardian email"
          type="email"
          autoComplete="off"
          inputMode="email"
          hint="SOS alerts are sent here."
          {...bind('email')}
        />
        <Input label="Guardian phone" type="tel" autoComplete="off" inputMode="tel" {...bind('phone')} />
      </div>
      <Footer saving={save.isPending} dirty={dirty} label="Save guardian" />
    </form>
  )
}

export function GuardianForm({ id = 'guardian' }: { id?: string }) {
  const q = useGuardian()
  return (
    <Card as="section" aria-labelledby={`${id}-title`} id={id}>
      <CardHeader
        id={`${id}-title`}
        title="Guardian"
        description="The person we contact in an emergency."
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
      />
      <LoadState loading={q.isPending} error={q.isError} onRetry={() => q.refetch()}>
        {q.data && <GuardianFields initial={q.data} />}
      </LoadState>
    </Card>
  )
}

/* ---------- Password ---------- */

export function PasswordForm({ id = 'password' }: { id?: string }) {
  const change = useChangePassword()
  const toast = useToast()
  const empty = { current: '', next: '', confirm: '' }
  const [values, setValues] = useState(empty)
  const [errors, setErrors] = useState<Partial<Record<keyof typeof empty, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const dirty = values.current !== '' || values.next !== '' || values.confirm !== ''

  const bind = (f: keyof typeof empty) => ({
    value: values[f],
    error: errors[f],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [f]: e.target.value })),
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found = stripEmpty({
      current: validateCurrentPassword(values.current),
      next: validateNewPassword(values.next, values.current),
      confirm: validateConfirm(values.next, values.confirm),
    })
    setErrors(found)
    if (Object.keys(found).length) return focusFirstInvalid(formRef.current)
    try {
      await change.mutateAsync({ current_password: values.current, new_password: values.next })
      setValues(empty)
      toast.show({ tone: 'success', title: 'Password updated' })
    } catch (err) {
      setServerError(msg(err))
    }
  }

  return (
    <Card as="section" aria-labelledby={`${id}-title`} id={id}>
      <CardHeader
        id={`${id}-title`}
        title="Change password"
        description="Use at least 8 characters, with a letter and a digit."
        icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
      />
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
        {serverError && <ErrorBanner message={serverError} />}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Current password" type="password" revealable autoComplete="current-password" {...bind('current')} />
          </div>
          <Input label="New password" type="password" revealable autoComplete="new-password" {...bind('next')} />
          <Input label="Confirm new password" type="password" revealable autoComplete="new-password" {...bind('confirm')} />
        </div>
        <Footer saving={change.isPending} dirty={dirty} label="Update password" />
      </form>
    </Card>
  )
}
