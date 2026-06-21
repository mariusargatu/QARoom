import type { VoteValueT } from '@qaroom/contracts'
import { advisoryLock } from '@qaroom/messaging'
import { eq, sql } from 'drizzle-orm'
import type { ContentDb } from '../db/client'
import { posts, votes } from '../db/schema'
import type { RepoDeps } from '../deps'
import { publishVoteCast } from '../events/vote-cast'

/**
 * Cast (or change) a vote and recompute the post score. Returns null if the post is absent.
 * `value` is the branded `VoteValueT` (±1), not a bare `number`: the type makes a 7 unrepresentable
 * at this seam, the request schema enforces it at the HTTP boundary, and the DB CHECK enforces it at
 * the table — three enforcements, one definition (contracts' VOTE_VALUES).
 */
export async function castVote(
  db: ContentDb,
  deps: RepoDeps,
  postId: string,
  voterId: string,
  value: VoteValueT,
): Promise<number | null> {
  // Deliberate SLO-regression switch (injected, see config/faults.ts): a fixed delay on the vote
  // write path so a k6 latency threshold breaches and the load gate turns red. 0 = no change.
  if (deps.faults.voteSlowMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, deps.faults.voteSlowMs))
  }
  // Deliberate ±1-invariant violation (injected): write an out-of-range value instead of the
  // validated ±1. The DB CHECK (votes_value_check) must reject it and the vote-value property test
  // must go red — the falsifier for the `vote-value-in-band` claim. Off = the validated value.
  const storedValue = deps.faults.voteOutOfRange ? value * 7 : value
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
      .values({ postId, voterId, value: storedValue, createdAt: castAt })
      .onConflictDoUpdate({
        target: [votes.postId, votes.voterId],
        set: { value: storedValue, createdAt: castAt },
      })
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
