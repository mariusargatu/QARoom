import { advisoryLock } from '@qaroom/messaging'
import { traced } from '@qaroom/otel'
import { asc, desc, eq, sql } from 'drizzle-orm'
import type { ContentDb } from '../db/client'
import { posts } from '../db/schema'
import type { RepoDeps } from '../deps'
import { publishPostCreated } from '../events/post-created'

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
      await publishPostCreated(tx, deps.ids, row)
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
  deps: RepoDeps,
  communityId: string,
  limit = 50,
): Promise<PostRecord[]> {
  // Deliberate-bug switches arrive injected (see config/faults.ts), not from process.env:
  //  - tenantLeak loosens the per-community scope to an always-true predicate (Commitment 9 leak).
  //  - feedReversed sorts oldest-first instead of newest-first (Milestone-7 regression demo).
  const rows = await db
    .select()
    .from(posts)
    .where(deps.faults.tenantLeak ? sql`true` : eq(posts.communityId, communityId))
    .orderBy(deps.faults.feedReversed ? asc(posts.createdAt) : desc(posts.createdAt))
    .limit(limit)
  return rows.map(rowToPost)
}
