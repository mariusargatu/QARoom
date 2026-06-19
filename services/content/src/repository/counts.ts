import { sql } from 'drizzle-orm'
import type { ContentDb } from '../db/client'
import { posts, votes } from '../db/schema'

/** Row counts for the `/system/state` models() body. Spans both domain tables. */
export async function countRows(db: ContentDb): Promise<{ posts: number; votes: number }> {
  const p = await db.select({ n: sql<number>`count(*)::int` }).from(posts)
  const v = await db.select({ n: sql<number>`count(*)::int` }).from(votes)
  return { posts: p[0]?.n ?? 0, votes: v[0]?.n ?? 0 }
}
