/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_WEBHOOK_DELIVERY, EXAMPLE_WHEN, WebhookDelivery } from '@qaroom/contracts'
import fc from 'fast-check'
import { expect, test } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { DeliveryList } from './DeliveryList'

// Organism component test (ADR-0027, composition-delta model): DeliveryList composes the proven Badge
// and Skeleton atoms. What the organism ADDS is the delivery row (status badge + event type + attempt
// + HTTP code + conditional next-attempt time) and the loading / empty fallbacks. Those are covered;
// the Badge / Skeleton internals are not re-asserted.

const delivered = WebhookDelivery.parse(EXAMPLE_WEBHOOK_DELIVERY)

const retrying = WebhookDelivery.parse({
  ...EXAMPLE_WEBHOOK_DELIVERY,
  status: 'Retrying',
  attempt: 2,
  last_status_code: 503,
  next_attempt_at: EXAMPLE_WHEN,
  updated_at: '2026-05-29T09:30:00.000Z',
})

test('a delivered row shows its status, event type, attempt and HTTP code', async () => {
  const screen = await render(<DeliveryList deliveries={[delivered]} />)

  await expect.element(screen.getByText('Delivered')).toBeVisible()
  await expect.element(screen.getByText('post.created')).toBeVisible()
  await expect.element(screen.getByText('attempt 1')).toBeVisible()
  await expect.element(screen.getByText('HTTP 200')).toBeVisible()
})

test('a retrying row shows its attempt, failed code and next attempt time', async () => {
  const screen = await render(<DeliveryList deliveries={[retrying]} />)

  await expect.element(screen.getByText('Retrying')).toBeVisible()
  await expect.element(screen.getByText('attempt 2')).toBeVisible()
  await expect.element(screen.getByText('HTTP 503')).toBeVisible()
  await expect.element(screen.getByText('next 2026-05-28 12:00')).toBeVisible()
})

test('the loading state marks the ledger busy', async () => {
  await render(<DeliveryList deliveries={[]} loading />)

  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
})

test('an empty ledger shows the no-deliveries copy', async () => {
  const screen = await render(<DeliveryList deliveries={[]} />)

  await expect.element(screen.getByText('No deliveries yet')).toBeVisible()
})

// Property: the two optional cells of a delivery row are each shown IFF their datum is present. This
// drives both arms of `last_status_code !== null` (a yet-unattempted Pending delivery carries a null
// code) and of `next_attempt_at ?` across the {present, absent} × {present, absent} shape — the
// example rows above only exercise three of the four corners. `examples` pins all four so the branch
// coverage is deterministic, not seed-dependent.
const codeArb = fc.option(fc.integer({ min: 100, max: 599 }), { nil: null })
const nextArb = fc.option(fc.constant(EXAMPLE_WHEN), { nil: null })

test('a row renders its HTTP-code cell iff a status code is present and its next-attempt cell iff one is scheduled', () => {
  return fc.assert(
    fc.asyncProperty(codeArb, nextArb, async (code, next) => {
      const delivery = WebhookDelivery.parse({
        ...EXAMPLE_WEBHOOK_DELIVERY,
        status: 'Pending',
        last_status_code: code,
        next_attempt_at: next,
      })
      const screen = await render(<DeliveryList deliveries={[delivery]} />)
      const text = screen.container.textContent ?? ''

      expect(text.includes('HTTP')).toBe(code !== null)
      expect(text.includes('next ')).toBe(next !== null)

      await cleanup()
    }),
    {
      numRuns: 20,
      examples: [
        [null, null],
        [200, null],
        [null, EXAMPLE_WHEN],
        [503, EXAMPLE_WHEN],
      ],
    },
  )
})
