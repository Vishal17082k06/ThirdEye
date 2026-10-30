import type { LucideIcon } from 'lucide-react'
import { Card, EmptyState } from '../design'

interface PagePlaceholderProps {
  title: string
  /** What this page will hold once it is built. */
  holds: string
  icon: LucideIcon
}

/** Temporary page body for features that are built in later tasks. It says exactly what will live here. */
export function PagePlaceholder({ title, holds, icon: Icon }: PagePlaceholderProps) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>
      <Card>
        <EmptyState
          icon={<Icon className="h-6 w-6" aria-hidden="true" />}
          title={`${title} is not built yet`}
          description={`This page will hold: ${holds}`}
        />
      </Card>
    </div>
  )
}
