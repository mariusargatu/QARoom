import { z } from 'zod'
import { CommunityId, EventId, ModerationDecisionId, PostId, UserId } from '../ids'

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting the NUL byte is the whole point.
const NO_NUL = /^[^\x00]*$/

/**
 * FROZEN v2 shape of `ModerationDecisionRecordedEvent` (Milestone 12, ADR-0020). The `disposition`
 * enum is INLINED (not imported from the live schema) so this record stays byte-stable if
 * `ModerationDisposition` later gains members. v2 is the current wire shape: it dropped v1's
 * `verdict`/`rule_id`/`reason` for a citation-bearing, three-valued `disposition` — a deliberate
 * breaking change, so the compat test asserts a CURRENT producer's output parses HERE (v2), while v1
 * is exercised only against a frozen v1-shaped literal (see `./events.compat.test.ts`). Deliberately
 * NOT registered (`no .meta({ id })`).
 */
export const ModerationDecisionRecordedEventV2 = z.object({
  event_id: EventId,
  decision_id: ModerationDecisionId,
  post_id: PostId,
  community_id: CommunityId,
  author_id: UserId,
  disposition: z.enum(['approve', 'remove', 'escalate_to_human']),
  cited_rules: z.array(z.string().max(100)).max(16),
  precedents: z.array(z.string().max(2_000).regex(NO_NUL, 'must not contain a NUL byte')).max(16),
  departs_from_precedent: z.boolean(),
  rationale: z.string().max(4_000).regex(NO_NUL, 'must not contain a NUL byte'),
  confidence: z.number().min(0).max(1),
  model: z.string().min(1).max(100),
  occurred_at: z.iso.datetime(),
})
export type ModerationDecisionRecordedEventV2 = z.infer<typeof ModerationDecisionRecordedEventV2>
