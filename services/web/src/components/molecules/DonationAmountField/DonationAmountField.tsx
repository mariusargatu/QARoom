import { TESTID } from '@qaroom/testing-utils/testids'
import { forwardRef, useId, useState } from 'react'
import { Button } from '../../atoms/Button'
import { Input } from '../../atoms/Input'

export interface DonationAmountFieldProps {
  disabled?: boolean
  pending?: boolean
  /** Called with the amount in cents when submitted. */
  onSubmit: (amountCents: number) => void
}

/** Molecule: a labelled amount input (dollars) + submit, emitting cents. */
export const DonationAmountField = forwardRef<HTMLFormElement, DonationAmountFieldProps>(
  function DonationAmountField({ disabled = false, pending = false, onSubmit }, ref) {
    const inputId = useId()
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
        {/*
          Uses the Input ATOM rather than a hand-rolled `<input>`. The local copy carried an
          unconditional `outline-none` with only `focus:border-primary` to replace it: a
          colour-only focus cue with no ring, so keyboard users lost the visible focus indicator
          this molecule is otherwise identical to the atom about. Composing the atom means the
          focus-visible ring is inherited and cannot drift again.
        */}
        <label htmlFor={inputId} className="flex flex-col gap-1 text-sm text-muted">
          Amount (USD)
        </label>
        <div className="flex flex-col gap-1">
          <Input
            id={inputId}
            data-testid={TESTID.donationAmount}
            inputMode="decimal"
            value={dollars}
            disabled={disabled}
            onChange={(e) => setDollars(e.target.value)}
            className="w-28"
          />
        </div>
        <Button type="submit" disabled={disabled || pending} data-testid={TESTID.donationSubmit}>
          Donate
        </Button>
      </form>
    )
  },
)
DonationAmountField.displayName = 'DonationAmountField'
