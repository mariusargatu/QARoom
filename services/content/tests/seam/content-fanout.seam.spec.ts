import {
  ALL_FEED_SUBJECTS,
  CommunityId,
  PostCreatedEvent,
  parseSubject,
  postsCreatedAnyCommunity,
  subjectMatchesFilter,
  VoteCastEvent,
  WebhookEventType,
} from '@qaroom/contracts'
import { createRelay, type TxRunner } from '@qaroom/messaging'
import { injectClient, setupServiceTest } from '@qaroom/testing-utils/harness'
import { brokerDouble, type PublishedMessage } from '@qaroom/testing-utils/scenario'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app'
import { ensureSchema } from '../../src/db/migrate'
import { asContentDb } from '../db-cast'
import { SAMPLE } from '../harness'

/**
 * SHARED-BROKER SEAM TEST (TEST-MAP wiring improvement #2). The per-service suites test each half of
 * the content→{webhooks,moderator} pipe with doubles; nothing asserts the seam as one transport. This
 * does: a real POST/vote drives content, the REAL relay drains the transactional outbox into one
 * in-memory broker, and each consumer's REAL routing + REAL contract schema decode the captured
 * envelope. It proves the bet contract testing leaves open — that the producer's actual wire shape is
 * the shape the consumers select and decode — in-process, deterministic, per-PR, no Docker.
 *
 * Consumer decode is expressed via the shared contracts (the authority both sides import), not by
 * importing the service modules: webhooks fan-out = `ALL_FEED_SUBJECTS` (the SAME array its consumer
 * binds its durable to — `WEBHOOK_FEED_SUBJECTS = ALL_FEED_SUBJECTS`, no re-listed copy) + the
 * `WebhookEventType` body of `classifyEventType`; the moderator = its cross-tenant wildcard +
 * `PostCreatedEvent`.
 */

const MODERATOR_FILTER = postsCreatedAnyCommunity()

const routedToWebhooks = (m: PublishedMessage): boolean =>
  ALL_FEED_SUBJECTS.some((f) => subjectMatchesFilter(f, m.subject))
const routedToModerator = (m: PublishedMessage): boolean =>
  subjectMatchesFilter(MODERATOR_FILTER, m.subject)

/** Entity token (position 2) via the grammar-aware parser, not a hand-indexed split. */
const entityOf = (m: PublishedMessage): string => parseSubject(m.subject).entity

async function setup() {
  const test = await setupServiceTest({
    applyMigrations: (db) => ensureSchema(db),
    createApp: (deps) =>
      buildApp({
        db: asContentDb(deps.db),
        clock: deps.clock,
        ids: deps.ids,
        randomness: deps.randomness,
      }),
  })
  return { ...test, request: injectClient(test.app) }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function drain(ctx: Ctx): Promise<PublishedMessage[]> {
  const broker = brokerDouble('up')
  await createRelay({
    db: ctx.db as unknown as TxRunner,
    publisher: broker,
    clock: ctx.clock,
  }).drainOnce()
  return broker.published
}

const createPost = (ctx: Ctx, community: string, key: string) =>
  ctx.request.post(
    `/api/communities/${community}/posts`,
    { author_id: SAMPLE.user, title: 'a title', body: 'a body' },
    { 'idempotency-key': key },
  )

describe('content → webhooks + moderator: post.created flows across one broker', () => {
  let ctx: Ctx
  afterEach(async () => {
    await ctx.close()
  })

  it('a created post is routed to BOTH consumers and decodes under each consumer contract', async () => {
    ctx = await setup()
    await createPost(ctx, SAMPLE.communityA, 'seam-1')
    const published = await drain(ctx)

    const postMsg = published.find((m) => entityOf(m) === 'posts')
    expect(postMsg).toBeDefined()
    const msg = postMsg as PublishedMessage

    // webhooks consumer: routed by the fan-out filter + classifies via the event-name header.
    expect(routedToWebhooks(msg)).toBe(true)
    expect(WebhookEventType.safeParse(msg.headers['event-name']).success).toBe(true)

    // moderator consumer: routed by the cross-tenant wildcard + decodes via the source schema.
    expect(routedToModerator(msg)).toBe(true)
    const event = PostCreatedEvent.parse(msg.payload)

    // tenant-leak guard the wildcard consumer relies on: subject position-3 === payload community.
    expect(parseSubject(msg.subject).communityId).toBe(event.community_id)
  })

  it('a cast vote is routed to webhooks but NOT to the moderator (posts-only wildcard)', async () => {
    ctx = await setup()
    const created = await createPost(ctx, SAMPLE.communityA, 'seam-2')
    const postId = (created.json as { id: string }).id
    await ctx.request.post(
      `/api/posts/${postId}/votes`,
      { voter_id: SAMPLE.user, value: 1 },
      { 'idempotency-key': 'seam-3' },
    )
    const voteMsg = (await drain(ctx)).find((m) => entityOf(m) === 'votes') as PublishedMessage

    expect(voteMsg).toBeDefined()
    expect(routedToWebhooks(voteMsg)).toBe(true)
    expect(routedToModerator(voteMsg)).toBe(false)
    expect(() => VoteCastEvent.parse(voteMsg.payload)).not.toThrow()
  })
})

describe('content → moderator: the cross-tenant wildcard never crosses tenants', () => {
  let ctx: Ctx
  afterEach(async () => {
    await ctx.close()
  })

  it('posts from two communities each carry their own tenant on subject and payload', async () => {
    ctx = await setup()
    await createPost(ctx, SAMPLE.communityA, 'seam-A')
    await createPost(ctx, SAMPLE.communityB, 'seam-B')

    const posts = (await drain(ctx)).filter((m) => entityOf(m) === 'posts')
    expect(posts).toHaveLength(2)

    for (const m of posts) {
      expect(routedToModerator(m)).toBe(true)
      const event = PostCreatedEvent.parse(m.payload)
      const subjectCommunity = parseSubject(m.subject).communityId
      // The re-validation the moderator performs on every wildcard message.
      expect(subjectCommunity).toBe(event.community_id)
    }

    const communities = posts.map((m) => parseSubject(m.subject).communityId).sort()
    expect(communities).toEqual([CommunityId.parse(SAMPLE.communityA), SAMPLE.communityB].sort())
  })
})
