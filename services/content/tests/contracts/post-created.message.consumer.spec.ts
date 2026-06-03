import { resolve } from 'node:path'
import { asynchronousBodyHandler, MatchersV3, MessageConsumerPact } from '@pact-foundation/pact'
import { PostCreatedEvent } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Pact v4 MESSAGE contract for the `post.created` event (Milestone 4). A representative
 * consumer declares the message shape it needs and the metadata the publisher must set —
 * including `Nats-Msg-Id` (Commitment 17: every emit carries the dedup id). Message Pact
 * uses an HTTP proxy in place of the broker, so this needs no running consumer service; the
 * provider verification (content emits a matching message) lands with flags-service, the
 * first real consumer, in Milestone 5 (ADR-0010).
 *
 * The deliberate-bug demonstration: a consumer handler that misreads the shape (e.g. expects
 * `postId` instead of `post_id`) fails `PostCreatedEvent.parse` here — in contract
 * verification — not at runtime against a live broker.
 */
const { like, regex } = MatchersV3
const ULID = '[0-9A-HJKMNP-TV-Z]{26}'
const brandExample = (prefix: string) => `${prefix}_00000000000000000000000000`

// Written under tests/contracts/pacts/ — deep enough that the HTTP-only `pact:verify` glob
// (services/*/pacts/*.json) never picks it up as an HTTP interaction, while still matching
// biome's `**/pacts` ignore (it is a generated artifact). Message-provider verification
// lands with flags-service in M5 (ADR-0010).
const messagePact = new MessageConsumerPact({
  consumer: 'community-projection',
  provider: 'content',
  dir: resolve(import.meta.dirname, 'pacts'),
  logLevel: 'warn',
})

describe('post.created message contract', () => {
  it('a consumer can process the published event and the publisher sets Nats-Msg-Id', async () => {
    await messagePact
      .expectsToReceive('a post created event')
      .withContent({
        event_id: regex(`^evt_${ULID}$`, brandExample('evt')),
        post_id: regex(`^post_${ULID}$`, brandExample('post')),
        community_id: regex(`^comm_${ULID}$`, brandExample('comm')),
        author_id: regex(`^user_${ULID}$`, brandExample('user')),
        title: like('a title'),
        body: like('a body'),
        created_at: like('2026-06-03T00:00:00.000Z'),
      })
      .withMetadata({
        'Nats-Msg-Id': regex(`^evt_${ULID}$`, brandExample('evt')),
        'event-name': 'post.created',
        'event-version': '1',
        'tenant.id': regex(`^comm_${ULID}$`, brandExample('comm')),
      })
      // The handler IS the consumer's expectation: parsing through the published schema is
      // the oracle. A shape it misreads throws here, failing verification.
      .verify(
        asynchronousBodyHandler(async (body) => {
          const event = PostCreatedEvent.parse(body)
          expect(event.community_id).toMatch(new RegExp(`^comm_${ULID}$`))
        }),
      )
  })
})
