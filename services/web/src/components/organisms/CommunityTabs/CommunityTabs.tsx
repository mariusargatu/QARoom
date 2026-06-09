import { forwardRef } from 'react'
import { NavLink } from 'react-router-dom'

export interface CommunityTabsProps {
  communityId: string
}

interface Tab {
  to: string
  label: string
  end?: boolean
}

/** Organism: the per-community section nav (feed, submit, donate, and the operator surfaces). */
export const CommunityTabs = forwardRef<HTMLElement, CommunityTabsProps>(function CommunityTabs(
  { communityId },
  ref,
) {
  const base = `/c/${communityId}`
  const tabs: Tab[] = [
    { to: base, label: 'Feed', end: true },
    { to: `${base}/submit`, label: 'Submit' },
    { to: `${base}/donate`, label: 'Donate' },
    { to: `${base}/flags`, label: 'Flags' },
    { to: `${base}/members`, label: 'Members' },
    { to: `${base}/webhooks`, label: 'Webhooks' },
    { to: `${base}/mod`, label: 'Moderation' },
    { to: `${base}/activity`, label: 'Activity' },
  ]

  return (
    <nav
      ref={ref}
      aria-label="Community sections"
      className="flex gap-5 overflow-x-auto border-b border-border [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-1 text-sm transition motion-reduce:transition-none ${
              isActive
                ? 'border-primary font-medium text-text'
                : 'border-transparent text-muted hover:text-text'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
})
CommunityTabs.displayName = 'CommunityTabs'
