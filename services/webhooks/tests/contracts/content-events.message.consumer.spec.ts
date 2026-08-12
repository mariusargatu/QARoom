import { resolve } from 'node:path'
import { MatchersV3, MessageConsumerPact } from '@pact-foundation/pact'
import {
  POST_CREATED_EVENT,
  PostCreatedEvent,
  VOTE_CAST_EVENT,
  VoteCastEvent,
} from '@qaroom/contracts'
import { describe, it } from 'vitest'
import { brandExample, consumesAs, feedMetadata, ULID } from './fanout-contract'

/**
 * webhooks → content message contracts (post.created, vote.cast).
 *
 * These replace `community-projection`, a consumer that DID NOT EXIST. Until 2026-08-11 the repo's
 * only message pact was written from a fictional service, so the async contract tier proved that an
 * imaginary consumer could parse content's events while the five real ones — webhooks (5 receive
 * operations) and donations (1) — had no contract at all. A contract with no consumer cannot go
 * stale in a way anybody notices, which is the failure mode consumer-driven contracts exist to stop.
 *
 * webhooks is a REAL consumer of both, via `WEBHOOK_FEED_SUBJECTS`. What it depends on — metadata
 * routing plus a forwardable body — is shared with its other feed contracts and lives in
 * `fanout-contract.ts`, so the four providers cannot drift into four different expectations.
 */
const { like, regex } = MatchersV3

const messagePact = new MessageConsumerPact({
  consumer: 'webhooks',
  provider: 'content',
  dir: resolve(import.meta.dirname, 'pacts'),
  logLevel: 'warn',
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
      .verify(consumesAs('post.created', PostCreatedEvent))
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
      .verify(consumesAs('vote.cast', VoteCastEvent))
  })
})
