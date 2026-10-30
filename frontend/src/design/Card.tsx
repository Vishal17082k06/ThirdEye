import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article'
  padded?: boolean
}

export function Card({ as: Tag = 'div', padded = true, className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn('bw rounded-2xl border-line bg-surface shadow-card', padded && 'p-5 sm:p-6', className)}
      {...rest}
    />
  )
}

interface CardHeaderProps {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  headingLevel?: 2 | 3
  id?: string
}

export function CardHeader({ title, description, icon, action, headingLevel = 2, id }: CardHeaderProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <Heading id={id} className="text-lg font-bold leading-snug text-ink">
            {title}
          </Heading>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
