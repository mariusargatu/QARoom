/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_DONATION } from '@qaroom/contracts'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { DonationList } from './DonationList'

// Organism component test (ADR-0027, composition-delta model): DonationList composes the proven Badge
// atom. What the organism ADDS is the donations section — the formatted money amount, the status badge
// per row, the formatted date, and the empty fallback. Those are covered; the Badge internals are not
// re-asserted.

test('a donation row shows its formatted amount, status and date', async () => {
  const screen = await render(
    <DonationList donations={[{ ...EXAMPLE_DONATION, status: 'Captured' }]} />,
  )

  await expect.element(screen.getByRole('region', { name: 'Donations' })).toBeVisible()
  await expect.element(screen.getByText('$25.00')).toBeVisible()
  await expect.element(screen.getByText('Captured')).toBeVisible()
  await expect.element(screen.getByText('2026-05-28')).toBeVisible()
})

test('each donation carries its own formatted amount and status badge', async () => {
  const screen = await render(
    <DonationList
      donations={[
        { ...EXAMPLE_DONATION, status: 'Captured' },
        {
          ...EXAMPLE_DONATION,
          id: 'dntn_01HZY0K7M3QF8VN2J5RX9TB4CN',
          amount_cents: 1000,
          status: 'Failed',
        },
      ]}
    />,
  )

  await expect.element(screen.getByText('Captured')).toBeVisible()
  await expect.element(screen.getByText('Failed')).toBeVisible()
  await expect.element(screen.getByText('$25.00')).toBeVisible()
  await expect.element(screen.getByText('$10.00')).toBeVisible()
})

test('an empty ledger shows the no-donations copy', async () => {
  const screen = await render(<DonationList donations={[]} />)

  await expect.element(screen.getByText('No donations yet.')).toBeVisible()
})
