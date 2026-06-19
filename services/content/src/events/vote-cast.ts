import {
  VOTE_CAST_EVENT,
  VOTE_CAST_VERSION,
  VoteCastEvent,
  voteCast,
} from '@qaroom/contracts'
import type { IdGenerator } from '@qaroom/determinism'
import { outboxPublish } from '@qaroom/messaging'

/** The transaction handle `outboxPublish` expects, taken from its own signature (driver-agnostic). */
type Tx = Parameters<typeof outboxPublish>[0]

export interface VoteCastFields {
  postId: string
  communityId: string
  voterId: string
  value: number
  score: number
  castAt: Date
}

/**
 * Build the `VoteCastEvent` and stage it on the transactional outbox (Commitment 17): the event row
 * commits atomically with the recomputed score, carrying that score on the wire. Validated through
 * the Zod schema so the wire shape cannot drift from the contract.
 */
export async function publishVoteCast(
  tx: Tx,
  ids: IdGenerator,
  vote: VoteCastFields,
): Promise<void> {
  const event = VoteCastEvent.parse({
    event_id: ids.next('evt'),
    post_id: vote.postId,
    community_id: vote.communityId,
    voter_id: vote.voterId,
    value: vote.value,
    score: vote.score,
    cast_at: vote.castAt.toISOString(),
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
    vote.castAt,
  )
}
