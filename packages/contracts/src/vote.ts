import { z } from 'zod'
import { PostId, UserId } from './ids'

/**
 * THE single source for the legal vote directions. The DB CHECK predicate (`voteValueCheckSql`, the
 * content-service migration) and the fast-check arbitrary (`voteValueArb` in @qaroom/testing-utils)
 * are mechanically DERIVED from this one array — change the rule here and those follow, no hand-typed
 * bounds.
 *
 * `VoteValue` below is written as a readable literal union, NOT mechanically derived (Zod 4's
 * `z.union` can't keep the `1 | -1` static type through a `.map()` over this array without a cast).
 * It is not a free-floating restatement, though: `vote.test.ts` pins `VoteValue` to accept EXACTLY
 * this set, so the union and the array cannot drift — a value added to one but not the other fails
 * that binding test. Two artifacts, one asserted-equal truth.
 */
export const VOTE_VALUES = [1, -1] as const
export type VoteValueT = (typeof VOTE_VALUES)[number]

/** A vote is +1 (up) or -1 (down). Removing a vote is a separate concern (Milestone 1+). */
export const VoteValue = z
  .union([z.literal(1), z.literal(-1)])
  .meta({ id: 'VoteValue', description: 'Vote direction: 1 (up) or -1 (down).' })
export type VoteValue = z.infer<typeof VoteValue>

/**
 * The DB CHECK predicate for an integer vote-value column, derived from `VOTE_VALUES` so the
 * database constraint can never disagree with the Zod schema above. The content-service migration
 * and the drizzle table definition both build their `CHECK` from this function — one rule, two
 * enforcement points, zero hand-typed bounds. Produces e.g. `value IN (1, -1)`.
 */
export function voteValueCheckSql(column: string): string {
  return `${column} IN (${VOTE_VALUES.join(', ')})`
}

/** `.strict()` rejects unexpected fields (matches OAS additionalProperties:false). */
export const CastVoteRequest = z
  .strictObject({
    voter_id: UserId,
    value: VoteValue,
  })
  .meta({ id: 'CastVoteRequest', description: 'Body for castVote.' })
export type CastVoteRequest = z.infer<typeof CastVoteRequest>

export const CastVoteResponse = z
  .object({
    post_id: PostId,
    score: z.number().int(),
    voter_value: VoteValue,
  })
  .meta({ id: 'CastVoteResponse', description: 'Resulting post score after a vote.' })
export type CastVoteResponse = z.infer<typeof CastVoteResponse>
