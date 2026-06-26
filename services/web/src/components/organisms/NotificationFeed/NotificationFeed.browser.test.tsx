/// <reference types="@vitest/browser/matchers" />
import {
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_DONATION_ID,
  EXAMPLE_USER_ID,
  WsEnvelope,
} from '@qaroom/contracts'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { NotificationFeed } from './NotificationFeed'

// Organism component test (ADR-0027, composition-delta model): NotificationFeed composes the proven
// Badge atom. These cover only what the FEED adds — the live-vs-polling connection badge it drives,
// its own `describe()` formatting of each envelope (incl. the cents→dollars conversion that must not
// drift 100×), and one row per event vs the empty fallback.

const FLAG_EVENT = WsEnvelope.parse({
  type: 'flag.state.changed',
  seq: 1,
  community_id: EXAMPLE_COMMUNITY_ID,
  occurred_at: '2026-06-04T00:00:00.000Z',
  flag_key: 'donations',
  state: 'Enabled',
  enabled: true,
})

const DONATION_EVENT = WsEnvelope.parse({
  type: 'donation.state.changed',
  seq: 2,
  community_id: EXAMPLE_COMMUNITY_ID,
  occurred_at: '2026-06-04T00:00:00.000Z',
  donation_id: EXAMPLE_DONATION_ID,
  donor_id: EXAMPLE_USER_ID,
  amount_cents: 2500,
  currency: 'USD',
  status: 'Captured',
})

test('a connected feed badges itself live', async () => {
  const screen = await render(<NotificationFeed events={[]} live />)

  await expect.element(screen.getByText('live')).toBeVisible()
})

test('the polling fallback badges itself polling', async () => {
  const screen = await render(<NotificationFeed events={[]} live={false} />)

  await expect.element(screen.getByText('polling')).toBeVisible()
})

test('a flag event renders a human-readable description', async () => {
  const screen = await render(<NotificationFeed events={[FLAG_EVENT]} />)

  await expect.element(screen.getByText('Flag "donations" → Enabled')).toBeVisible()
})

test('a donation event renders its amount in whole dollars (no 100× drift)', async () => {
  const screen = await render(<NotificationFeed events={[DONATION_EVENT]} />)

  await expect.element(screen.getByText('Donation Captured (25 USD)')).toBeVisible()
})

test('an empty feed reports no activity yet', async () => {
  const screen = await render(<NotificationFeed events={[]} />)

  await expect.element(screen.getByText('No activity yet.')).toBeVisible()
})
