import { z } from 'zod'
import { CommunityId, EventId, PostId, UserId } from '../ids'
import { VoteValue } from '../vote'

/**
 * Emitted when a vote is cast — subject `qaroom.content.votes.<community_id>.cast`.
 *
 * Carries the resulting aggregate `score` so a consumer can update a tally without
 * recomputing. `event_id` doubles as the `Nats-Msg-Id` and the `processed_events` key.
 * Non-strict object for forward-compatibility (conventions §2).
 */
export const VoteCastEvent = z
  .object({
    event_id: EventId,
    post_id: PostId,
    community_id: CommunityId,
    voter_id: UserId,
    value: VoteValue,
    score: z.number().int(),
    cast_at: z.iso.datetime(),
  })
  .meta({ id: 'VoteCastEvent', description: 'Emitted when a vote is cast on a post.' })
export type VoteCastEvent = z.infer<typeof VoteCastEvent>

/** Canonical event name — NATS header `event-name` and the AsyncAPI message name. */
export const VOTE_CAST_EVENT = 'vote.cast'
/** Schema version — NATS header `event-version`; bumped only on a breaking change. */
export const VOTE_CAST_VERSION = 1
