import {
  POST_CREATED_EVENT,
  POST_CREATED_VERSION,
  PostCreatedEvent,
  postCreated,
  VOTE_CAST_EVENT,
  VOTE_CAST_VERSION,
  VoteCastEvent,
  voteCast,
} from '@qaroom/contracts'
import { advisoryLock, outboxPublish } from '@qaroom/messaging'
import { traced } from '@qaroom/otel'
import { asc, desc, eq, sql } from 'drizzle-orm'
import type { ContentDb } from './db/client'
import { posts, votes } from './db/schema'
import type { RepoDeps } from './deps'

/** snake_case post record matching the `Post` contract; handlers parse/brand it. */
export interface PostRecord {
  id: string
  community_id: string
  author_id: string
  title: string
  body: string
  score: number
  created_at: string
}

export interface CreatePostInput {
  communityId: string
  authorId: string
  title: string
  body: string
}

function rowToPost(r: typeof posts.$inferSelect): PostRecord {
  return {
    id: r.id,
    community_id: r.communityId,
    author_id: r.authorId,
    title: r.title,
    body: r.body,
    score: r.score,
    created_at: r.createdAt.toISOString(),
  }
}

export async function createPost(
  db: ContentDb,
  deps: RepoDeps,
  input: CreatePostInput,
): Promise<PostRecord> {
  // Explicit DB span (porsager `postgres` has no maintained OTel auto-instrumentation, ADR-0009).
  // The span is a child of the route span and inherits the request's `tenant.id`.
  return traced('db.posts.create', async () => {
    const row = {
      id: deps.ids.next('post'),
      communityId: input.communityId,
      authorId: input.authorId,
      title: input.title,
      body: input.body,
      score: 0,
      createdAt: deps.clock.now(),
    }
    await db.transaction(async (tx) => {
      await advisoryLock(tx, row.id)
      await tx.insert(posts).values(row)
      // Transactional outbox (Commitment 17): the event row commits atomically with the
      // post. The relay drains it to JetStream; `event_id` doubles as the `Nats-Msg-Id`.
      const event = PostCreatedEvent.parse({
        event_id: deps.ids.next('evt'),
        post_id: row.id,
        community_id: row.communityId,
        author_id: row.authorId,
        title: row.title,
        body: row.body,
        created_at: row.createdAt.toISOString(),
      })
      await outboxPublish(
        tx,
        {
          eventId: event.event_id,
          subject: postCreated(event.community_id),
          eventName: POST_CREATED_EVENT,
          eventVersion: POST_CREATED_VERSION,
          communityId: event.community_id,
          payload: event,
        },
        row.createdAt,
      )
    })
    deps.lamport.bump()
    // One row object, one mapper: the insert and the returned record cannot drift.
    return rowToPost(row)
  })
}

export async function getPost(db: ContentDb, postId: string): Promise<PostRecord | null> {
  const rows = await db.select().from(posts).where(eq(posts.id, postId)).limit(1)
  const r = rows[0]
  return r ? rowToPost(r) : null
}

export async function listFeed(
  db: ContentDb,
  communityId: string,
  limit = 50,
): Promise<PostRecord[]> {
  // Deliberate-bug toggle for the Milestone-7 regression scenario: when set, the feed is sorted
  // oldest-first instead of newest-first — a wrong-order bug whose reproduction depends on the
  // captured posts' timestamps (not the replay clock). Read per call so a single test process can
  // show the bug reproduce (toggle on), then the fix (toggle off) replay green. Off in normal use.
  const feedOrderBug = process.env.CONTENT_BUG_FEED_REVERSED === '1'
  // Deliberate tenancy-leak toggle (Commitment 9): when set, the per-community scope is loosened to
  // an always-true predicate, so the feed returns EVERY tenant's posts — the cross-tenant read the
  // property-based isolation test (and the `tenant-isolation` claim) must catch. Read per call,
  // mirroring CONTENT_BUG_FEED_REVERSED, so one test process shows the leak (toggle on → red) and
  // the fix (toggle off → green). Off in normal use.
  const tenantLeakBug = process.env.CONTENT_BUG_TENANT_LEAK === '1'
  const rows = await db
    .select()
    .from(posts)
    .where(tenantLeakBug ? sql`true` : eq(posts.communityId, communityId))
    .orderBy(feedOrderBug ? asc(posts.createdAt) : desc(posts.createdAt))
    .limit(limit)
  return rows.map(rowToPost)
}

/** Cast (or change) a vote and recompute the post score. Returns null if the post is absent. */
export async function castVote(
  db: ContentDb,
  deps: RepoDeps,
  postId: string,
  voterId: string,
  value: number,
): Promise<number | null> {
  // Deliberate SLO-regression toggle (Milestone-8 k6 exit criterion): when set, injects a fixed
  // delay into the vote write path so a k6 latency threshold deliberately breaches and the load
  // gate turns red — the load analogue of CONTENT_BUG_FEED_REVERSED. Read per call so a single CI
  // step proves the lane is sensitive (slow run → red, clean run → green). 0 = no behavioural change.
  const slowMs = Number(process.env.CONTENT_BUG_VOTE_SLOW_MS ?? 0)
  if (slowMs > 0) await new Promise((resolve) => setTimeout(resolve, slowMs))
  const score = await db.transaction(async (tx) => {
    await advisoryLock(tx, postId)
    const found = await tx
      .select({ id: posts.id, communityId: posts.communityId })
      .from(posts)
      .where(eq(posts.id, postId))
      .for('update')
      .limit(1)
    const post = found[0]
    if (!post) return null
    const createdAt = deps.clock.now()
    await tx
      .insert(votes)
      .values({ postId, voterId, value, createdAt })
      .onConflictDoUpdate({ target: [votes.postId, votes.voterId], set: { value, createdAt } })
    const agg = await tx
      .select({ s: sql<number>`coalesce(sum(${votes.value}), 0)::int` })
      .from(votes)
      .where(eq(votes.postId, postId))
    const next = agg[0]?.s ?? 0
    await tx.update(posts).set({ score: next }).where(eq(posts.id, postId))
    // Transactional outbox (Commitment 17): the vote event commits with the score update.
    const event = VoteCastEvent.parse({
      event_id: deps.ids.next('evt'),
      post_id: postId,
      community_id: post.communityId,
      voter_id: voterId,
      value,
      score: next,
      cast_at: createdAt.toISOString(),
    })
    await outboxPublish(
      tx,
      {
        eventId: event.event_id,
        subject: voteCast(event.community_id),
        eventName: VOTE_CAST_EVENT,
        eventVersion: VOTE_CAST_VERSION,
        communityId: event.community_id,
        payload: event,
      },
      createdAt,
    )
    return next
  })
  if (score !== null) deps.lamport.bump()
  return score
}

export async function countRows(db: ContentDb): Promise<{ posts: number; votes: number }> {
  const p = await db.select({ n: sql<number>`count(*)::int` }).from(posts)
  const v = await db.select({ n: sql<number>`count(*)::int` }).from(votes)
  return { posts: p[0]?.n ?? 0, votes: v[0]?.n ?? 0 }
}
