import type { Donation, DonationStatus } from '@qaroom/contracts'
import { TESTID } from '@qaroom/testing-utils/testids'
import { forwardRef } from 'react'
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

// One formatter per currency, reused across rows/renders (constructing Intl.NumberFormat is the costly part).
const formatters = new Map<string, Intl.NumberFormat>()
function money(cents: number, currency: string): string {
  let formatter = formatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency })
    formatters.set(currency, formatter)
  }
  return formatter.format(cents / 100)
}

/** Organism: the list of a community's donations with status badges. */
export const DonationList = forwardRef<HTMLElement, DonationListProps>(function DonationList(
  { donations },
  ref,
) {
  return (
    <section
      ref={ref}
      aria-label="Donations"
      data-testid={TESTID.donationList}
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-text">Donations</h2>
      {donations.length === 0 ? (
        <p className="text-sm text-muted">No donations yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {donations.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-sm">
              <span className="text-text">{money(d.amount_cents, d.currency)}</span>
              <Badge tone={TONE[d.status]}>{d.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
DonationList.displayName = 'DonationList'
