import { Save } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, Card, CardHeader, useToast } from '../../design'
import { ApiError } from '../../lib/api'
import { ErrorBanner } from '../auth/FormBanner'

interface SectionFormProps {
  id: string
  title: string
  description: string
  icon: ReactNode
  dirty: boolean
  /** Return a message string to show a validation problem; throw (e.g. ApiError) for server failures. */
  onSave: () => Promise<string | void> | string | void
  children: ReactNode
}

/** One card, one Save button: loading state, inline error and success toast live here so every section behaves the same. */
export function SectionForm({ id, title, description, icon, dirty, onSave, children }: SectionFormProps) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setError(null)
    setSaving(true)
    try {
      const problem = await onSave()
      if (typeof problem === 'string') {
        setError(problem)
        setTimeout(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0)
      } else toast.show({ tone: 'success', title: `${title} settings saved` })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card as="section" id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <CardHeader id={`${id}-title`} title={title} description={description} icon={icon} />
      <form onSubmit={submit} noValidate className="space-y-5">
        {error && <ErrorBanner message={error} />}
        {children}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={saving} leftIcon={<Save className="h-5 w-5" aria-hidden="true" />}>
            {saving ? 'Saving' : `Save ${title.toLowerCase()}`}
          </Button>
          {dirty && !saving && <span className="text-sm font-semibold text-warning">Unsaved changes</span>}
        </div>
      </form>
    </Card>
  )
}
