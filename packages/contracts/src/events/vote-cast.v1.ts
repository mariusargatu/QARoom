import { z } from 'zod'
import { CommunityId, EventId, PostId, UserId } from '../ids'
import { VoteValue } from '../vote'

/**
 * FROZEN v1 shape of `VoteCastEvent` (Milestone 4). See `post-created.v1.ts` for the
 * freeze discipline. Not registered in the Zod global registry, so it never leaks into
 * the generated AsyncAPI document.
 */
export const VoteCastEventV1 = z.object({
  event_id: EventId,
  post_id: PostId,
  community_id: CommunityId,
  voter_id: UserId,
  value: VoteValue,
  score: z.number().int(),
  cast_at: z.iso.datetime(),
})
export type VoteCastEventV1 = z.infer<typeof VoteCastEventV1>
