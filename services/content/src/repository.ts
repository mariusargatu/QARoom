import { traced } from '@qaroom/otel'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { ContentDb, SqlExecutor } from './db/client'
import { idempotencyResponses, posts, votes } from './db/schema'
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

export interface StoredResponse {
  status: number
  body: unknown
}

/**
 * Single-writer-per-resource (Commitment 4): serialize concurrent writers to the
 * same resource via a transaction-scoped Postgres advisory lock keyed on the id.
 */
async function advisoryLock(ex: SqlExecutor, resourceId: string): Promise<void> {
  await ex.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${resourceId}, 0))`)
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
  const rows = await db
    .select()
    .from(posts)
    .where(eq(posts.communityId, communityId))
    .orderBy(desc(posts.createdAt))
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
  const score = await db.transaction(async (tx) => {
    await advisoryLock(tx, postId)
    const found = await tx
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, postId))
      .for('update')
      .limit(1)
    if (found.length === 0) return null
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
    return next
  })
  if (score !== null) deps.lamport.bump()
  return score
}

export async function findIdempotent(
  db: ContentDb,
  key: string,
  route: string,
  hash: string,
): Promise<StoredResponse | null> {
  const rows = await db
    .select()
    .from(idempotencyResponses)
    .where(
      and(
        eq(idempotencyResponses.idempotencyKey, key),
        eq(idempotencyResponses.route, route),
        eq(idempotencyResponses.bodyHash, hash),
      ),
    )
    .limit(1)
  const r = rows[0]
  return r ? { status: r.status, body: r.responseBody } : null
}

export async function storeIdempotent(
  db: ContentDb,
  deps: RepoDeps,
  record: { key: string; route: string; hash: string; status: number; body: unknown },
): Promise<void> {
  await db
    .insert(idempotencyResponses)
    .values({
      idempotencyKey: record.key,
      route: record.route,
      bodyHash: record.hash,
      status: record.status,
      responseBody: record.body,
      createdAt: deps.clock.now(),
    })
    .onConflictDoNothing()
}

export async function countRows(db: ContentDb): Promise<{ posts: number; votes: number }> {
  const p = await db.select({ n: sql<number>`count(*)::int` }).from(posts)
  const v = await db.select({ n: sql<number>`count(*)::int` }).from(votes)
  return { posts: p[0]?.n ?? 0, votes: v[0]?.n ?? 0 }
}
