import { resolve } from 'node:path'
import { DonationStateChangedEvent, donationStateChanged, parseSubject } from '@qaroom/contracts'
import { createRelay, type TxRunner } from '@qaroom/messaging'
import { messageFromPact, verifyEnvelopeAgainstMessage } from '@qaroom/testing-utils/contracts'
import { brokerDouble, type PublishedMessage } from '@qaroom/testing-utils/scenario'
import { afterEach, describe, expect, it } from 'vitest'
import { enableDonations, SAMPLE, setupDonationsTest } from '../harness'

/**
 * PROVIDER verification of the `donation.state.changed` message contract.
 *
 * donations-service published this event with no consumer contract on it at all — a producer nobody
 * had pinned. webhooks fans it out to third-party endpoints, which makes the money-shaped fields the
 * ones that matter: a subscriber renders `amount_cents`, `currency` and `status` straight from the
 * forwarded payload, so a rename or a units change would reach paying integrations before it reached
 * anyone here. `asyncapi:verify` cannot catch that — it regenerates the spec from the same Zod
 * schema the change edited, so both sides move together and the drift gate stays green.
 *
 * Same shape as content's and flags' provider specs: drive the real endpoint, drain the
 * transactional outbox through the REAL relay into a capturing broker, and check the captured wire
 * envelope (payload + NATS headers) against the consumer's pinned pact. In-process, no broker.
 */
const PACT_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'webhooks',
  'tests',
  'contracts',
  'pacts',
  'webhooks-donations.json',
)

type Ctx = Awaited<ReturnType<typeof setupDonationsTest>>

/** Create a donation, drain the outbox through the real relay, return the captured message. */
async function captureDonationChange(ctx: Ctx): Promise<PublishedMessage> {
  await enableDonations(ctx, SAMPLE.communityA)
  const created = await ctx.request.post(
    `/api/communities/${SAMPLE.communityA}/donations`,
    { donor_id: SAMPLE.user, amount_cents: 2500, currency: 'USD' },
    { 'idempotency-key': 'k-donation-provider-1' },
  )
  expect(created.status).toBe(201)

  const broker = brokerDouble('up')
  await createRelay({
    db: ctx.db as unknown as TxRunner,
    publisher: broker,
    clock: ctx.clock,
  }).drainOnce()

  const found = broker.published.find((m) => parseSubject(m.subject).entity === 'donation')
  expect(found, "no published message with entity 'donation'").toBeDefined()
  return found as PublishedMessage
}

describe('donations publishes a donation.state.changed envelope matching the consumer pact', () => {
  let ctx: Ctx
  afterEach(async () => {
    await ctx.close()
  })

  it('the captured wire envelope satisfies every body + metadata matching rule', async () => {
    ctx = await setupDonationsTest()
    const message = await captureDonationChange(ctx)

    const mismatches = verifyEnvelopeAgainstMessage(
      { payload: message.payload as Record<string, unknown>, headers: message.headers },
      messageFromPact(PACT_PATH, 'a donation state changed event'),
    )
    expect(mismatches).toEqual([])
  })

  it('the captured payload round-trips through the published DonationStateChangedEvent schema', async () => {
    ctx = await setupDonationsTest()
    const message = await captureDonationChange(ctx)
    expect(() => DonationStateChangedEvent.parse(message.payload)).not.toThrow()
  })

  it('sets Nats-Msg-Id equal to the payload event_id (the dedup contract)', async () => {
    ctx = await setupDonationsTest()
    const message = await captureDonationChange(ctx)
    const event = DonationStateChangedEvent.parse(message.payload)
    expect(message.headers['Nats-Msg-Id']).toBe(event.event_id)
    expect(message.headers['event-name']).toBe('donation.state.changed')
    expect(message.headers['event-version']).toBe('1')
    expect(message.headers['tenant.id']).toBe(event.community_id)
    // The SUBJECT carries the tenancy boundary (community at position 3): a correct payload on a
    // cross-tenant subject would pass every body/header check and still leak across communities.
    expect(message.subject).toBe(donationStateChanged(event.community_id))
  })
})
