import { z } from 'zod'
import { ModerationDisposition } from './events/moderation-decision-recorded'
import { CommunityId, EventId, ModerationDecisionId, PostId, UserId } from './ids'
import { AsOf } from './lamport'

/**
 * Moderation-decision READ model (Milestone 12, ADR-0020). The moderator-agent (Python) owns the
 * decision store and exposes these reads; the gateway proxies them so the web frontend can render a
 * moderation dashboard. This mirrors the agent's Pydantic `ModerationDecision` (services/moderator-
 * agent/src/moderator_agent/schemas.py) — note the REST read uses `created_at` where the NATS event
 * (`ModerationDecisionRecordedEvent`) uses `occurred_at`. The disposition enum is the SAME source
 * (reused from the event schema), so the read and the event can never disagree on the verdict space.
 *
 * This is a read projection, not a new wire contract: the cross-language gate
 * (`test_schemas_crosslang.py`) pins only the event schema, so this schema is purely additive.
 */

// A rationale / precedent echoes user-derived content; mirror the post body's NUL guard.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting the NUL byte is the whole point.
const NO_NUL = /^[^\x00]*$/

/** A grounded moderation decision recorded by the agent for one post. */
export const ModerationDecision = z
  .object({
    decision_id: ModerationDecisionId,
    event_id: EventId,
    post_id: PostId,
    community_id: CommunityId,
    author_id: UserId,
    disposition: ModerationDisposition,
    cited_rules: z.array(z.string().max(100)).max(16),
    precedents: z.array(z.string().max(2_000).regex(NO_NUL, 'must not contain a NUL byte')).max(16),
    departs_from_precedent: z.boolean(),
    rationale: z.string().max(4_000).regex(NO_NUL, 'must not contain a NUL byte'),
    confidence: z.number().min(0).max(1),
    model: z.string().min(1).max(100),
    created_at: z.iso.datetime(),
  })
  .meta({ id: 'ModerationDecision', description: 'A grounded moderation decision for a post.' })
export type ModerationDecision = z.infer<typeof ModerationDecision>

/** A community's moderation decisions, newest first, with a read consistency envelope. */
export const ModerationDecisionList = z
  .object({
    decisions: z.array(ModerationDecision),
    as_of: AsOf,
  })
  .meta({
    id: 'ModerationDecisionList',
    description: 'A community’s moderation decisions with a read envelope.',
  })
export type ModerationDecisionList = z.infer<typeof ModerationDecisionList>
