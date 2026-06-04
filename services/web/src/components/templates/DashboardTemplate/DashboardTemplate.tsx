import { forwardRef, type ReactNode } from 'react'

export interface DashboardTemplateProps {
  header: ReactNode
  rollout: ReactNode
  donation: ReactNode
  donations: ReactNode
  activity: ReactNode
}

/**
 * Template: pure two-column dashboard layout. Holds NO data and NO organisms of its own — the
 * page fills the named slots. This keeps the layout reusable and the import direction clean
 * (templates compose nothing below themselves except layout primitives).
 */
export const DashboardTemplate = forwardRef<HTMLDivElement, DashboardTemplateProps>(
  function DashboardTemplate({ header, rollout, donation, donations, activity }, ref) {
    return (
      <div ref={ref} className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <header className="flex items-center justify-between">{header}</header>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            {rollout}
            {donation}
          </div>
          <div className="flex flex-col gap-4">
            {donations}
            {activity}
          </div>
        </div>
      </div>
    )
  },
)
DashboardTemplate.displayName = 'DashboardTemplate'
