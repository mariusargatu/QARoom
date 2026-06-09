import { forwardRef } from 'react'
import { DonationAmountField } from '../../molecules/DonationAmountField'

export interface DonationFormProps {
  /** Whether the donations flag has reached Enabled for this community. */
  enabled: boolean
  pending?: boolean
  error?: string
  onDonate: (amountCents: number) => void
}

/** Organism: the donation entry section (hairline, not a card), gated on the donations flag (mirrors the server gate). */
export const DonationForm = forwardRef<HTMLElement, DonationFormProps>(function DonationForm(
  { enabled, pending = false, error, onDonate },
  ref,
) {
  return (
    <section ref={ref} aria-label="Make a donation" className="border-t border-border pt-4">
      <h2 className="mb-3 font-display text-lg font-medium text-text">Make a donation</h2>
      {enabled ? (
        <DonationAmountField pending={pending} onSubmit={onDonate} />
      ) : (
        <p className="text-sm text-muted">
          Donations are not enabled for this community yet. Roll out the donations flag to Enabled
          first.
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
})
DonationForm.displayName = 'DonationForm'
