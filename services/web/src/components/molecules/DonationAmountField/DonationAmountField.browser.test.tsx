/// <reference types="@vitest/browser/matchers" />
import { TESTID } from '@qaroom/testing-utils/testids'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DonationAmountField } from './DonationAmountField'

// Molecule component test (ADR-0027, composition-delta): DonationAmountField composes the proven Button
// atom; this covers only what the MOLECULE adds — the dollars→cents conversion, the positive-amount
// guard, and the pending lockout. The Button's own behavior is not re-asserted here.

test('submitting converts the entered dollar amount to cents', async () => {
  const onSubmit = vi.fn()
  const screen = await render(<DonationAmountField onSubmit={onSubmit} />)

  await screen.getByTestId(TESTID.donationAmount).fill('10')
  await screen.getByTestId(TESTID.donationSubmit).click()

  expect(onSubmit).toHaveBeenCalledWith(1000)
})

test('a non-positive amount does not submit', async () => {
  const onSubmit = vi.fn()
  const screen = await render(<DonationAmountField onSubmit={onSubmit} />)

  await screen.getByTestId(TESTID.donationAmount).fill('0')
  await screen.getByTestId(TESTID.donationSubmit).click()

  expect(onSubmit).not.toHaveBeenCalled()
})

test('pending disables the submit button', async () => {
  const screen = await render(<DonationAmountField pending onSubmit={vi.fn()} />)

  await expect.element(screen.getByTestId(TESTID.donationSubmit)).toBeDisabled()
})
