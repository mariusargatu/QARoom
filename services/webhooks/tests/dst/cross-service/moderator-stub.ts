import { SeededRandomness } from '@qaroom/testing-utils/determinism'

/**
 * The moderator as a SEEDED SIM CONSUMER (T22, ADR-0029 §"the LLM edge"; ADR-0018 "proposes, never
 * enforces"). In production the moderator-agent is a LangGraph trajectory that ends in a model call —
 * the one inherently non-deterministic seam in the whole fleet. Deterministic simulation draws its
 * KERNEL BOUNDARY exactly there: everything up to the decision (subscribing to the bus, per-durable
 * delivery, dedup) is the SAME real DST machinery the other services use, and only the model call is
 * replaced — here by `decide`, a seeded canned-disposition function. So the bolted-on LLM shows up as
 * "just another consumer on the bus whose one oracle-free step is stubbed", not as a special case
 * that breaks reproducibility. The stub also never publishes back and never mutates content/webhooks
 * — it records a decision and stops (the agent proposes; it does not enforce).
 */

/** The simulated disposition vocabulary (a strict subset of the real `disposition` enum, ADR-0020). */
export type Disposition = 'approve' | 'remove' | 'escalate_to_human'

const DISPOSITIONS: readonly Disposition[] = ['approve', 'remove', 'escalate_to_human']

/** One recorded decision — the deterministic observable the composed history fingerprints. */
export interface ModeratorDecision {
  eventId: string
  communityId: string
  disposition: Disposition
}

export interface ModeratorStub {
  /** Every decision recorded, in consume order. */
  readonly decisions: ModeratorDecision[]
  /** Event ids already decided — the consumer's own idempotency (it dedupes like any consumer). */
  readonly seen: Set<string>
  /**
   * The STUBBED model call — the kernel boundary. A real moderator would run an LLM here; the sim
   * substitutes a seeded canned disposition so the trajectory stays reproducible. Records the
   * decision (idempotent per eventId) and returns it; a repeat eventId returns the first decision.
   */
  decide(event: { eventId: string; communityId: string; payload: unknown }): Disposition
}

export function moderatorStub(seed: number): ModeratorStub {
  const rng = new SeededRandomness(seed)
  const decisions: ModeratorDecision[] = []
  const seen = new Set<string>()
  const byEvent = new Map<string, Disposition>()

  return {
    decisions,
    seen,
    decide(event) {
      const prior = byEvent.get(event.eventId)
      if (prior !== undefined) return prior // idempotent: a redelivery yields the same decision
      const disposition = DISPOSITIONS[rng.int(0, DISPOSITIONS.length - 1)] ?? 'escalate_to_human'
      seen.add(event.eventId)
      byEvent.set(event.eventId, disposition)
      decisions.push({ eventId: event.eventId, communityId: event.communityId, disposition })
      return disposition
    },
  }
}
