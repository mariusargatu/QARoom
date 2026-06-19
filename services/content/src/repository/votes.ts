import { advisoryLock } from '@qaroom/messaging'
import { eq, sql } from 'drizzle-orm'
import type { ContentDb } from '../db/client'
import { posts, votes } from '../db/schema'
import type { RepoDeps } from '../deps'
import { publishVoteCast } from '../events/vote-cast'

/** Cast (or change) a vote and recompute the post score. Returns null if the post is absent. */
export async function castVote(
  db: ContentDb,
  deps: RepoDeps,
  postId: string,
  voterId: string,
  value: number,
): Promise<number | null> {
  // Deliberate SLO-regression switch (injected, see config/faults.ts): a fixed delay on the vote
  // write path so a k6 latency threshold breaches and the load gate turns red. 0 = no change.
  if (deps.faults.voteSlowMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, deps.faults.voteSlowMs))
  }
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
    const castAt = deps.clock.now()
    await tx
      .insert(votes)
      .values({ postId, voterId, value, createdAt: castAt })
      .onConflictDoUpdate({ target: [votes.postId, votes.voterId], set: { value, createdAt: castAt } })
    const agg = await tx
      .select({ s: sql<number>`coalesce(sum(${votes.value}), 0)::int` })
      .from(votes)
      .where(eq(votes.postId, postId))
    const next = agg[0]?.s ?? 0
    await tx.update(posts).set({ score: next }).where(eq(posts.id, postId))
    await publishVoteCast(tx, deps.ids, {
      postId,
      communityId: post.communityId,
      voterId,
      value,
      score: next,
      castAt,
    })
    return next
  })
  if (score !== null) deps.lamport.bump()
  return score
}
