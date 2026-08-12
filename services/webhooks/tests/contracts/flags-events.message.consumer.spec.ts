import { resolve } from 'node:path'
import { MatchersV3, MessageConsumerPact } from '@pact-foundation/pact'
import { FLAG_STATE_CHANGED_EVENT, FlagStateChangedEvent } from '@qaroom/contracts'
import { describe, it } from 'vitest'
import { brandExample, consumesAs, feedMetadata, ULID } from './fanout-contract'

/**
 * webhooks → flags message contract (flag.state.changed).
 *
 * flags already had a consumer contract from donations, but donations and webhooks depend on
 * DIFFERENT things: donations reads `enabled` to gate its endpoints, webhooks routes on the headers
 * and forwards the whole body to a subscriber's endpoint. One consumer's pact is not a substitute
 * for another's — flags could satisfy donations' expectations while breaking the payload webhooks
 * ships to third parties.
 */
const { like, regex } = MatchersV3

const messagePact = new MessageConsumerPact({
  consumer: 'webhooks',
  provider: 'flags',
  dir: resolve(import.meta.dirname, 'pacts'),
  logLevel: 'warn',
})

describe('webhooks consumes the flags rollout event it fans out', () => {
  it('routes, scopes and dedups the event from its metadata, and forwards a schema-valid body', async () => {
    await messagePact
      .expectsToReceive('a flag state changed event')
      .withContent({
        event_id: regex(`^evt_${ULID}$`, brandExample('evt')),
        community_id: regex(`^comm_${ULID}$`, brandExample('comm')),
        flag_key: like('donations'),
        // A real transition from the rollout machine — FlagState is an enum
        // (Off/Enabling/Canary/Enabled/Disabling) and the handler parses through it.
        from_state: like('Canary'),
        to_state: like('Enabled'),
        rollout_event: like('RolloutCompleted'),
        enabled: like(true),
        occurred_at: like('2026-06-03T00:00:00.000Z'),
      })
      .withMetadata(feedMetadata(FLAG_STATE_CHANGED_EVENT))
      .verify(consumesAs('flag.state.changed', FlagStateChangedEvent))
  })
})
