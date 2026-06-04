import { forwardRef } from 'react'
import { DonationAmountField } from '../../molecules/DonationAmountField'

export interface DonationFormProps {
  /** Whether the donations flag has reached Enabled for this community. */
  enabled: boolean
  pending?: boolean
  onDonate: (amountCents: number) => void
}

/** Organism: the donation entry card, gated on the donations flag (mirrors the server gate). */
export const DonationForm = forwardRef<HTMLElement, DonationFormProps>(function DonationForm(
  { enabled, pending = false, onDonate },
  ref,
) {
  return (
    <section
      ref={ref}
      aria-label="Make a donation"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-text">Make a donation</h2>
      {enabled ? (
        <DonationAmountField pending={pending} onSubmit={onDonate} />
      ) : (
        <p className="text-sm text-muted">
          Donations are not enabled for this community yet. Roll out the donations flag to Enabled
          first.
        </p>
      )}
    </section>
  )
})
DonationForm.displayName = 'DonationForm'
