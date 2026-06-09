import { forwardRef, type ReactNode } from 'react'
import { Card } from '../../atoms/Card'

export interface EmptyStateProps {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
}

/** Molecule: the canonical "nothing here yet" panel. */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { title, description, icon, action },
  ref,
) {
  return (
    <Card ref={ref} className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon ? (
        <span aria-hidden="true" className="text-2xl text-muted">
          {icon}
        </span>
      ) : null}
      <p className="text-base font-semibold text-text">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </Card>
  )
})
EmptyState.displayName = 'EmptyState'
