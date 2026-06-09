import type { Donation, DonationStatus } from '@qaroom/contracts'
import { TESTID } from '@qaroom/testing-utils/testids'
import { forwardRef } from 'react'
import { formatDate, formatMoney } from '../../../lib/format'
import { Badge, type BadgeTone } from '../../atoms/Badge'

export interface DonationListProps {
  donations: readonly Donation[]
}

const TONE: Record<DonationStatus, BadgeTone> = {
  Pending: 'neutral',
  Authorized: 'primary',
  Captured: 'success',
  Failed: 'danger',
  Refunded: 'warning',
}

/**
 * Organism: a community's donations as hairline-separated rows (DESIGN.md), not a card grid. Each
 * row pairs a tabular-nums amount with a status Badge and the date; the section owns the rule.
 */
export const DonationList = forwardRef<HTMLElement, DonationListProps>(function DonationList(
  { donations },
  ref,
) {
  return (
    <section ref={ref} aria-label="Donations" data-testid={TESTID.donationList}>
      <h2 className="mb-3 font-display text-lg font-medium text-text">Recent donations</h2>
      {donations.length === 0 ? (
        <p className="text-sm text-muted">No donations yet.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {donations.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-4 py-4">
              <span className="text-sm font-medium tabular-nums text-text">
                {formatMoney(d.amount_cents, d.currency)}
              </span>
              <div className="flex items-center gap-3">
                <Badge tone={TONE[d.status]}>{d.status}</Badge>
                <span className="text-xs tabular-nums text-muted">{formatDate(d.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
DonationList.displayName = 'DonationList'
