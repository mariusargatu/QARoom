import { resolve } from 'node:path'
import { MatchersV3, MessageConsumerPact } from '@pact-foundation/pact'
import { DONATION_STATE_CHANGED_EVENT, DonationStateChangedEvent } from '@qaroom/contracts'
import { describe, it } from 'vitest'
import { brandExample, consumesAs, feedMetadata, ULID } from './fanout-contract'

/**
 * webhooks → donations message contract (donation.state.changed).
 *
 * donations-service had no consumer contract on its published event at all — it was a producer
 * nobody had pinned. The money-shaped fields are the reason this one matters more than most: a
 * webhook subscriber renders `amount_cents`, `currency` and `status` straight from the forwarded
 * payload, so a silent rename or a units change reaches third parties before it reaches anyone here.
 */
const { like, regex } = MatchersV3

const messagePact = new MessageConsumerPact({
  consumer: 'webhooks',
  provider: 'donations',
  dir: resolve(import.meta.dirname, 'pacts'),
  logLevel: 'warn',
})

describe('webhooks consumes the donations lifecycle event it fans out', () => {
  it('routes, scopes and dedups the event from its metadata, and forwards a schema-valid body', async () => {
    await messagePact
      .expectsToReceive('a donation state changed event')
      .withContent({
        event_id: regex(`^evt_${ULID}$`, brandExample('evt')),
        community_id: regex(`^comm_${ULID}$`, brandExample('comm')),
        donation_id: regex(`^dntn_${ULID}$`, brandExample('dntn')),
        donor_id: regex(`^user_${ULID}$`, brandExample('user')),
        amount_cents: like(2500),
        // ISO 4217, three uppercase letters — pinned as a REGEX, not a type matcher, because a
        // currency that stopped being a valid code would still be "a string".
        currency: regex('^[A-Z]{3}$', 'USD'),
        // DonationStatus is an enum (Pending/Authorized/Captured/Failed/Refunded).
        status: like('Captured'),
        occurred_at: like('2026-06-03T00:00:00.000Z'),
      })
      .withMetadata(feedMetadata(DONATION_STATE_CHANGED_EVENT))
      .verify(consumesAs('donation.state.changed', DonationStateChangedEvent))
  })
})
