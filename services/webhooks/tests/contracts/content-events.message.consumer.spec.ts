import { resolve } from 'node:path'
import { MatchersV3, MessageConsumerPact } from '@pact-foundation/pact'
import {
  POST_CREATED_EVENT,
  PostCreatedEvent,
  VOTE_CAST_EVENT,
  VoteCastEvent,
} from '@qaroom/contracts'
import { readEventHeaders } from '@qaroom/messaging'
import { describe, expect, it } from 'vitest'
import { classifyEventType } from '../../src/consumer'

/**
 * webhooks → content message contracts (post.created, vote.cast).
 *
 * These replace `community-projection`, a consumer that DID NOT EXIST. Until 2026-08-11 the repo's
 * only message pact was written from a fictional service, so the async contract tier proved that an
 * imaginary consumer could parse content's events while the five real ones — webhooks (5 receive
 * operations) and donations (1) — had no contract at all. A contract with no consumer cannot go
 * stale in a way anybody notices, which is the failure mode consumer-driven contracts exist to stop.
 *
 * webhooks is a REAL consumer of both, via `WEBHOOK_FEED_SUBJECTS`. What it actually depends on is
 * mostly METADATA, and the expectations below say so rather than over-claiming: the fan-out routes
 * on the `event-name` header (`classifyEventType`), scopes on `tenant.id`, and dedups on
 * `Nats-Msg-Id` (`processed_events`). The body is pinned through the published schema because a
 * delivered webhook forwards it to the subscriber verbatim — so its shape IS part of what webhooks
 * promises onward, even though the fan-out itself does not read individual fields.
 */
const { like, regex } = MatchersV3
const ULID = '[0-9A-HJKMNP-TV-Z]{26}'
const brandExample = (prefix: string) => `${prefix}_00000000000000000000000000`

const messagePact = new MessageConsumerPact({
  consumer: 'webhooks',
  provider: 'content',
  dir: resolve(import.meta.dirname, 'pacts'),
  logLevel: 'warn',
})

/** The metadata every fan-out event must carry, whatever its body. */
const feedMetadata = (eventName: string) => ({
  'Nats-Msg-Id': regex(`^evt_${ULID}$`, brandExample('evt')),
  'event-name': eventName,
  'event-version': '1',
  'tenant.id': regex(`^comm_${ULID}$`, brandExample('comm')),
})

describe('webhooks consumes content post.created', () => {
  it('routes, scopes and dedups the event from its metadata, and forwards a schema-valid body', async () => {
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
      .withMetadata(feedMetadata(POST_CREATED_EVENT))
      // The handler IS the expectation: the real header reader and the real event classifier,
      // so a rename on either side fails here rather than silently dropping the fan-out. NOT
      // `asynchronousBodyHandler` — that is `(m) => handler(m.contents)`, which drops the metadata
      // this consumer routes on, leaving the headers unverified.
      .verify(async (message) => {
        const headers = readEventHeaders(message.metadata as Record<string, string>)
        expect(classifyEventType(headers.eventName)).toBe('post.created')
        expect(headers.communityId).toMatch(new RegExp(`^comm_${ULID}$`))
        expect(headers.eventId).toMatch(new RegExp(`^evt_${ULID}$`))
        expect(PostCreatedEvent.parse(message.contents).community_id).toBe(headers.communityId)
      })
  })
})

describe('webhooks consumes content vote.cast', () => {
  it('routes, scopes and dedups the event from its metadata, and forwards a schema-valid body', async () => {
    await messagePact
      .expectsToReceive('a vote cast event')
      .withContent({
        event_id: regex(`^evt_${ULID}$`, brandExample('evt')),
        post_id: regex(`^post_${ULID}$`, brandExample('post')),
        community_id: regex(`^comm_${ULID}$`, brandExample('comm')),
        voter_id: regex(`^user_${ULID}$`, brandExample('user')),
        value: like(1),
        score: like(1),
        cast_at: like('2026-06-03T00:00:00.000Z'),
      })
      .withMetadata(feedMetadata(VOTE_CAST_EVENT))
      .verify(async (message) => {
        const headers = readEventHeaders(message.metadata as Record<string, string>)
        expect(classifyEventType(headers.eventName)).toBe('vote.cast')
        expect(headers.communityId).toMatch(new RegExp(`^comm_${ULID}$`))
        expect(VoteCastEvent.parse(message.contents).community_id).toBe(headers.communityId)
      })
  })
})
