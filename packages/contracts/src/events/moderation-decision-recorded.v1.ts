import { z } from 'zod'
import { CommunityId, EventId, ModerationDecisionId, PostId, UserId } from '../ids'

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting the NUL byte is the whole point.
const NO_NUL = /^[^\x00]*$/

/**
 * FROZEN v1 shape of `ModerationDecisionRecordedEvent` (Milestone 9). The `verdict` enum is
 * INLINED (not imported from the live schema) so this record stays byte-stable if
 * `ModerationVerdict` later gains members. The compat test asserts a current producer's output
 * still parses here (conventions §2). Deliberately NOT registered (`no .meta({ id })`).
 */
export const ModerationDecisionRecordedEventV1 = z.object({
  event_id: EventId,
  decision_id: ModerationDecisionId,
  post_id: PostId,
  community_id: CommunityId,
  author_id: UserId,
  verdict: z.enum(['allow', 'flag']),
  rule_id: z.string().max(100).nullable(),
  reason: z.string().max(2_000).regex(NO_NUL, 'must not contain a NUL byte'),
  confidence: z.number().min(0).max(1),
  model: z.string().min(1).max(100),
  occurred_at: z.iso.datetime(),
})
export type ModerationDecisionRecordedEventV1 = z.infer<typeof ModerationDecisionRecordedEventV1>
