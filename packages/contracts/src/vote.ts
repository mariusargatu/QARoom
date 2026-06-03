import { z } from 'zod'
import { PostId, UserId } from './ids'

/** A vote is +1 (up) or -1 (down). Removing a vote is a separate concern (Milestone 1+). */
export const VoteValue = z
  .union([z.literal(1), z.literal(-1)])
  .meta({ id: 'VoteValue', description: 'Vote direction: 1 (up) or -1 (down).' })
export type VoteValue = z.infer<typeof VoteValue>

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
