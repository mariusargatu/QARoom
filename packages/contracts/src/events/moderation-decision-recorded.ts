import { z } from 'zod'
import { CommunityId, EventId, ModerationDecisionId, PostId, UserId } from '../ids'

// A rationale / precedent echoes user-derived content; mirror the post body's NUL guard so a consumer
// rejects un-storable text rather than discovering it at write time (see `./post-created.ts`).
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting the NUL byte is the whole point.
const NO_NUL = /^[^\x00]*$/

/**
 * The agent's disposition for a post (Milestone 12, ADR-0020). The retrieval-grounded moderator
 * PROPOSES `approve` (clear) or `remove` (policy-violating), or `escalate_to_human` when retrieval
 * confidence is low or rules conflict — it never enforces (ADR-0018). This REPLACES the v1
 * `verdict ∈ {allow, flag}` enum: a two-value verdict cannot express "I don't know — escalate", and
 * a grounded agent that abstains needs that third state. The widening is a breaking change, hence the
 * version bump (the frozen v1 shape lives in `./moderation-decision-recorded.v1.ts`).
 */
export const ModerationDisposition = z
  .enum(['approve', 'remove', 'escalate_to_human'])
  .meta({ id: 'ModerationDisposition' })
export type ModerationDisposition = z.infer<typeof ModerationDisposition>

/**
 * Emitted when the moderator-agent records a decision for a post — subject
 * `qaroom.moderator.decision.<community_id>.recorded` (Milestone 9; re-scoped to a retrieval-grounded
 * RAG agent in Milestone 12, ADR-0020). The agent OWNS its decisions (its own Postgres + this event)
 * and never mutates content- or flags-service; a downstream review queue or notifier acts on this
 * without calling back (ADR-0018).
 *
 * The verdict is now CITATION-BEARING and grounded in retrieved policy: `cited_rules` are the policy
 * entries the decision rests on, `precedents` the prior decisions consulted, `departs_from_precedent`
 * flags an intentional divergence, and `rationale` is the explanation traceable to those retrieved
 * chunks (FR3/FR4, ADR-0020). This makes faithfulness + precedent-consistency testable surfaces.
 *
 * Cross-language contract: this Zod schema is the source of truth. The Python service emits a
 * Pydantic mirror; BOTH validate against the generated JSON Schema at
 * `services/moderator-agent/contracts/moderation-decision-recorded.schema.json` (drift-gated by
 * `moderation-decision-recorded.schema.test.ts` here and by a pytest on the Python side).
 *
 * Versioning: this is v2. v1 (`verdict ∈ {allow, flag}`, `rule_id`, `reason`) is frozen at
 * `./moderation-decision-recorded.v1.ts`; v2's frozen baseline is `./moderation-decision-recorded.v2.ts`.
 * Dropping `verdict`/`rule_id`/`reason` is a deliberate BREAKING change (the repo's first), so the
 * compat test asserts the v2 shape against v2 — not against v1 — and the event-version header is 2.
 */
export const ModerationDecisionRecordedEvent = z
  .object({
    event_id: EventId,
    decision_id: ModerationDecisionId,
    post_id: PostId,
    community_id: CommunityId,
    author_id: UserId,
    disposition: ModerationDisposition,
    // The policy entries (rule/guideline ids) the decision is grounded in. Empty on a clean `approve`.
    cited_rules: z.array(z.string().max(100)).max(16),
    // Prior-decision summaries consulted as precedent. Echoes stored content → mirror the NUL guard.
    precedents: z.array(z.string().max(2_000).regex(NO_NUL, 'must not contain a NUL byte')).max(16),
    // The verdict knowingly diverges from the retrieved precedent (FR4). `rationale` must say why.
    departs_from_precedent: z.boolean(),
    // The grounded explanation, traceable to the cited rules + precedents (FR3).
    rationale: z.string().max(4_000).regex(NO_NUL, 'must not contain a NUL byte'),
    confidence: z.number().min(0).max(1),
    // The pinned model id that produced the verdict (GenAI provenance; ADR-0018).
    model: z.string().min(1).max(100),
    occurred_at: z.iso.datetime(),
  })
  .meta({
    id: 'ModerationDecisionRecordedEvent',
    description: 'Emitted when the moderator-agent records a grounded decision for a post.',
  })
export type ModerationDecisionRecordedEvent = z.infer<typeof ModerationDecisionRecordedEvent>

/** Canonical event name — NATS header `event-name` and the AsyncAPI message name. */
export const MODERATION_DECISION_RECORDED_EVENT = 'moderation.decision.recorded'
/** Schema version — NATS header `event-version`; bumped to 2 by the M12 breaking change (ADR-0020). */
export const MODERATION_DECISION_RECORDED_VERSION = 2

/**
 * The cross-language JSON Schema derived from the Zod source. The single home for the
 * `z.toJSONSchema` call, used by both the generator (`pnpm moderator:contracts`) and its
 * vitest drift gate, so the committed file at
 * `services/moderator-agent/contracts/moderation-decision-recorded.schema.json` can never drift
 * from the Zod schema the rest of the system enforces. The Python service validates its Pydantic
 * output against the same committed file.
 */
export function moderationDecisionRecordedJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ModerationDecisionRecordedEvent) as Record<string, unknown>
}
