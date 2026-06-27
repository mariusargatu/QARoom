import { CommunityId, parseSubject } from '@qaroom/contracts'
import { createRelay, type TxRunner } from '@qaroom/messaging'
import { injectClient, setupServiceTest } from '@qaroom/testing-utils/harness'
import { brokerDouble, type PublishedMessage } from '@qaroom/testing-utils/scenario'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app'
import { ensureSchema } from '../../src/db/migrate'
import { asContentDb } from '../db-cast'
import { SAMPLE } from '../harness'
import { moderatorPod } from './moderator-pod'

/**
 * DEGRADED-MODE PROOF (T10). The platform's best design decision is that moderation is async: the
 * moderator-agent consumes `post.created` events and PROPOSES dispositions, but it never sits on the
 * create path (ADR-0018). So a dead moderator must not stop a community from posting. That decision
 * has been asserted nowhere — until here.
 *
 * The whole content service runs in-process on PGlite with its REAL transactional outbox + relay; the
 * moderator is its REAL durable-consumer binding modelled by `moderatorPod` (the cross-tenant
 * `posts.created` wildcard + `PostCreatedEvent` decode). NATS is healthy; only the moderator POD is
 * down. We prove: creation still 201s and persists, `post.created` is durably published, and the
 * moderator drains the retained backlog once it returns. Deterministic, per-PR, no Docker.
 */

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

/**
 * Drain content's transactional outbox once into a HEALTHY broker and return everything the relay
 * published. The broker is `up` on purpose: NATS is fine, only the moderator pod is down — so the
 * stream retains `post.created` for the consumer that is not yet there.
 */
async function drainOutbox(ctx: Ctx): Promise<PublishedMessage[]> {
  const broker = brokerDouble('up')
  await createRelay({
    db: ctx.db as unknown as TxRunner,
    publisher: broker,
    clock: ctx.clock,
  }).drainOnce()
  return broker.published
}

const idOf = (body: unknown): string => String((body as { id?: unknown }).id ?? '')

const createPost = (ctx: Ctx, community: string, key: string) =>
  ctx.request.post(
    `/api/communities/${community}/posts`,
    { author_id: SAMPLE.user, title: 'a title', body: 'a body' },
    { 'idempotency-key': key },
  )

describe('degraded mode: a down moderator never blocks post creation (ADR-0018)', () => {
  let ctx: Ctx
  afterEach(async () => {
    await ctx.close()
  })

  it('POST /posts 201s and persists with the moderator down, then moderation drains when it returns', async () => {
    ctx = await setup()
    // The moderator-agent pod is DOWN. NATS is up; only the async consumer is unavailable.
    const moderator = moderatorPod({ up: false })

    // 1. Creation succeeds with the moderator down. A create path that BLOCKED on the moderator would
    //    surface a 5xx dependency_failure here, so the strict 201 is the severity hook.
    const created = await createPost(ctx, SAMPLE.communityA, 'degraded-1')
    expect(created.status).toBe(201)
    const postId = idOf(created.json)

    // 2. Persistence is independent of moderation: the post reads back regardless of moderator state.
    const fetched = await ctx.request.get(`/api/posts/${postId}`)
    expect(fetched.status).toBe(200)
    expect(idOf(fetched.json)).toBe(postId)

    // 3. The async hand-off happened durably: exactly one `post.created` is on the stream the
    //    moderator consumes (relay drained the outbox). A down moderator does not lose it.
    const stream = await drainOutbox(ctx)
    const postEvents = stream.filter((m) => parseSubject(m.subject).entity === 'posts')
    expect(postEvents).toHaveLength(1)
    const postEvent = postEvents[0] as PublishedMessage
    expect((postEvent.payload as { post_id: string }).post_id).toBe(postId)

    // 4. While the moderator is DOWN it consumes nothing — no decision exists, yet creation already
    //    returned 201 (step 1). Proof the create path did not wait on moderation.
    moderator.consume(stream)
    expect(moderator.decisions).toEqual([])

    // 5. The moderator returns and drains the backlog the stream retained for it (at-least-once):
    //    moderation now lands for exactly the post created while it was down.
    moderator.bringUp()
    moderator.consume(stream)
    expect(moderator.decisions).toEqual([
      { postId, communityId: CommunityId.parse(SAMPLE.communityA) },
    ])
  })
})
