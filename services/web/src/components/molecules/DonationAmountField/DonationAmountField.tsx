import { TESTID } from '@qaroom/testing-utils/testids'
import { forwardRef, useState } from 'react'
import { Button } from '../../atoms/Button'

export interface DonationAmountFieldProps {
  disabled?: boolean
  pending?: boolean
  /** Called with the amount in cents when submitted. */
  onSubmit: (amountCents: number) => void
}

/** Molecule: a labelled amount input (dollars) + submit, emitting cents. */
export const DonationAmountField = forwardRef<HTMLFormElement, DonationAmountFieldProps>(
  function DonationAmountField({ disabled = false, pending = false, onSubmit }, ref) {
    const [dollars, setDollars] = useState('25')

    return (
      <form
        ref={ref}
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const cents = Math.round(Number(dollars) * 100)
          if (Number.isFinite(cents) && cents > 0) onSubmit(cents)
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-muted">
          Amount (USD)
          <input
            data-testid={TESTID.donationAmount}
            inputMode="decimal"
            value={dollars}
            disabled={disabled}
            onChange={(e) => setDollars(e.target.value)}
            className="w-28 rounded-md border border-border bg-surface px-2 py-2 text-text outline-none focus:border-primary disabled:opacity-50"
          />
        </label>
        <Button type="submit" disabled={disabled || pending} data-testid={TESTID.donationSubmit}>
          Donate
        </Button>
      </form>
    )
  },
)
DonationAmountField.displayName = 'DonationAmountField'
