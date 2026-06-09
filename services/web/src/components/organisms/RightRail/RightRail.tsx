import { forwardRef } from 'react'
import { formatDate, formatMoney } from '../../../lib/format'
import { Badge } from '../../atoms/Badge'

export interface RightRailProps {
  name: string
  slug: string
  memberCount?: number
  createdAt?: string
  donationsEnabled?: boolean
  totalDonationsCents?: number
  currency?: string
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-text">{children}</span>
    </div>
  )
}

/**
 * Organism: the community "about" sidebar. Shows only stats the backend actually exposes — there is
 * no description/rules field on a Community, so we don't invent one.
 */
export const RightRail = forwardRef<HTMLDivElement, RightRailProps>(function RightRail(
  { name, slug, memberCount, createdAt, donationsEnabled, totalDonationsCents, currency = 'USD' },
  ref,
) {
  return (
    <aside ref={ref} className="flex flex-col gap-3">
      <div>
        <p className="font-display text-lg font-medium text-text">{name}</p>
        <p className="text-xs text-muted">/{slug}</p>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {memberCount !== undefined ? <Row label="Members">{memberCount}</Row> : null}
        {createdAt ? <Row label="Created">{formatDate(createdAt)}</Row> : null}
        {donationsEnabled !== undefined ? (
          <Row label="Donations">
            <Badge tone={donationsEnabled ? 'success' : 'neutral'}>
              {donationsEnabled ? 'Enabled' : 'Off'}
            </Badge>
          </Row>
        ) : null}
        {totalDonationsCents !== undefined ? (
          <Row label="Raised">{formatMoney(totalDonationsCents, currency)}</Row>
        ) : null}
      </div>
    </aside>
  )
})
RightRail.displayName = 'RightRail'
