import { z } from 'zod'
import { CommunityId, EventId, ModerationDecisionId, PostId, UserId } from '../ids'

// A reason echoes user-derived content; mirror the post body's NUL guard so a consumer rejects
// un-storable text rather than discovering it at write time (see `./post-created.ts`).
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting the NUL byte is the whole point.
const NO_NUL = /^[^\x00]*$/

/** The agent's verdict for a post. It PROPOSES (`flag`) or clears (`allow`); it never enforces (ADR-0018). */
export const ModerationVerdict = z.enum(['allow', 'flag']).meta({ id: 'ModerationVerdict' })
export type ModerationVerdict = z.infer<typeof ModerationVerdict>

/**
 * Emitted when the moderator-agent records a decision for a post — subject
 * `qaroom.moderator.decision.<community_id>.recorded` (Milestone 9). The agent OWNS its
 * decisions (its own Postgres + this event) and never mutates content- or flags-service; a
 * downstream review queue or notifier acts on this without calling back (ADR-0018).
 *
 * Cross-language contract: this Zod schema is the source of truth. The Python service emits a
 * Pydantic mirror; BOTH validate against the generated JSON Schema at
 * `services/moderator-agent/contracts/moderation-decision-recorded.schema.json` (drift-gated by
 * `moderation-decision-recorded.schema.test.ts` here and by a pytest on the Python side). Defined
 * non-strict on purpose: an additive optional field stays forward-compatible for an older consumer
 * (conventions §2); a breaking change freezes the prior shape as `moderation-decision-recorded.v1.ts`.
 */
export const ModerationDecisionRecordedEvent = z
  .object({
    event_id: EventId,
    decision_id: ModerationDecisionId,
    post_id: PostId,
    community_id: CommunityId,
    author_id: UserId,
    verdict: ModerationVerdict,
    // The community rule the post violates (`flag`), or null when allowed.
    rule_id: z.string().max(100).nullable(),
    reason: z.string().max(2_000).regex(NO_NUL, 'must not contain a NUL byte'),
    confidence: z.number().min(0).max(1),
    // The pinned model id that produced the verdict (GenAI provenance; ADR-0018).
    model: z.string().min(1).max(100),
    occurred_at: z.iso.datetime(),
  })
  .meta({
    id: 'ModerationDecisionRecordedEvent',
    description: 'Emitted when the moderator-agent records a decision for a post.',
  })
export type ModerationDecisionRecordedEvent = z.infer<typeof ModerationDecisionRecordedEvent>

/** Canonical event name — NATS header `event-name` and the AsyncAPI message name. */
export const MODERATION_DECISION_RECORDED_EVENT = 'moderation.decision.recorded'
/** Schema version — NATS header `event-version`; bumped only on a breaking change. */
export const MODERATION_DECISION_RECORDED_VERSION = 1

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
