/**
 * The runtime binding between spec/tla/Dedup.tla and the at-least-once consumer path
 * (ADR-0024, Phase 3; T19).
 *
 * Dedup.tla proves that an event the broker delivers AT LEAST ONCE applies its handler effect AT
 * MOST ONCE (`NoDoubleApply`) — the reason `processed_events` exists. This is the same safety
 * relation, projected onto the consumer's decision at the boundary: a handler must never APPLY its
 * effect for an event that is already recorded as processed. The live guard is the `alreadyProcessed`
 * check (dedup.ts) under a transaction-scoped advisory lock; this assertion pins the rule the guard
 * encodes, so a future refactor that lets a recorded event re-run its effect (a double-apply) throws
 * at the boundary instead of silently double-applying.
 *
 * Like the webhook binding, this is the STRUCTURAL safety projection. The Milestone-4 dedup
 * deliberate-bug (deleting `markProcessed`) is SEMANTICALLY different: it never records, so `recorded`
 * stays false and this guard never fires — that bug is caught end-to-end by the duplicate-delivery
 * property test. The spec-level twin of that bug is the commented `BugDeliver` action in Dedup.tla.
 */
export interface DedupDecision {
  /** Is (subscription, event) already present in processed_events? */
  recorded: boolean
  /** Is the consumer about to run the handler's effect this delivery? */
  applying: boolean
}

/**
 * Throw if a delivery would apply the handler effect for an already-recorded event — the
 * double-apply that violates Dedup.tla's `NoDoubleApply`. The legal decisions are: a first sight
 * (`!recorded`) applies + records; a recognised duplicate (`recorded`) skips.
 */
export function assertIdempotentApply(decision: DedupDecision): void {
  if (decision.recorded && decision.applying) {
    throw new Error(
      'double-apply: handler effect re-applied for an already-recorded event (violates Dedup.tla NoDoubleApply)',
    )
  }
}
