import { resolve } from 'node:path'
import { MatchersV3, MessageConsumerPact } from '@pact-foundation/pact'
import {
  CommunityId,
  FLAG_STATE_CHANGED_EVENT,
  FLAGS_FEED_SUBJECT,
  FlagStateChangedEvent,
  flagStateChanged,
  subjectMatchesFilter,
} from '@qaroom/contracts'
import { readEventHeaders } from '@qaroom/messaging'
import { describe, expect, it } from 'vitest'

/**
 * donations → flags message contract (flag.state.changed).
 *
 * donations is the other REAL async consumer the repo had no contract for: `src/consumer.ts` binds
 * `FLAGS_FEED_SUBJECT` and calls `FlagStateChangedEvent.parse(payload)` to keep its gating cache
 * current. Unlike webhooks' fan-out — which routes on metadata and forwards the body untouched —
 * donations READS the body, so this contract pins the fields it actually acts on: `enabled` is the
 * gating projection it caches, and `community_id` scopes it.
 *
 * The consequence of the gap this closes: flags could drop or rename `enabled` and no contract test
 * anywhere would notice. `asyncapi:verify` would still pass (the spec regenerates from Zod) and so
 * would `contract:breaking` if the change were declared — while donations silently gated on
 * `undefined`.
 */
const { like, regex } = MatchersV3
const ULID = '[0-9A-HJKMNP-TV-Z]{26}'
const brandExample = (prefix: string) => `${prefix}_00000000000000000000000000`
const COMMUNITY = CommunityId.parse(brandExample('comm'))

const messagePact = new MessageConsumerPact({
  consumer: 'donations',
  provider: 'flags',
  dir: resolve(import.meta.dirname, 'pacts'),
  logLevel: 'warn',
})

describe('donations consumes the flags rollout event that gates its endpoints', () => {
  it('parses the published schema and reads the enabled projection it caches', async () => {
    await messagePact
      .expectsToReceive('a flag state changed event')
      .withContent({
        event_id: regex(`^evt_${ULID}$`, brandExample('evt')),
        community_id: regex(`^comm_${ULID}$`, brandExample('comm')),
        flag_key: like('donations'),
        // A REAL transition from the rollout machine (Canary --RolloutCompleted--> Enabled), not a
        // plausible-looking invention: `FlagState` is an enum of Off/Enabling/Canary/Enabled/
        // Disabling, and the handler parses through it, so a made-up state fails here.
        from_state: like('Canary'),
        to_state: like('Enabled'),
        rollout_event: like('RolloutCompleted'),
        enabled: like(true),
        occurred_at: like('2026-06-03T00:00:00.000Z'),
      })
      .withMetadata({
        'Nats-Msg-Id': regex(`^evt_${ULID}$`, brandExample('evt')),
        'event-name': FLAG_STATE_CHANGED_EVENT,
        'event-version': '1',
        'tenant.id': regex(`^comm_${ULID}$`, brandExample('comm')),
      })
      .verify(async (message) => {
        const headers = readEventHeaders(message.metadata as Record<string, string>)
        const event = FlagStateChangedEvent.parse(message.contents)
        // The two fields the gating cache is built from — a rename of either breaks donations.
        expect(typeof event.enabled).toBe('boolean')
        expect(event.community_id).toBe(headers.communityId)
      })
  })

  // The contract is only worth anything if the event reaches donations at all: its durable binds
  // FLAGS_FEED_SUBJECT, so the subject flags publishes on must be selected by that filter.
  it('binds a filter that selects the subject flags publishes this event on', () => {
    expect(subjectMatchesFilter(FLAGS_FEED_SUBJECT, flagStateChanged(COMMUNITY))).toBe(true)
  })
})
