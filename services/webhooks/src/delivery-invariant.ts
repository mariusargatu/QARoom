import type { WebhookDeliveryStateName } from '@qaroom/contracts'

/**
 * The runtime binding between spec/tla/WebhookDelivery.tla and this service (ADR-0024, Phase 3).
 *
 * The TLA model proves the delivery protocol holds under all interleavings; this is the SAME legal
 * committed-transition relation (the model's `Next`, projected onto persisted state) enforced at the
 * real boundary — `assertLegalDeliveryCommit` is called before every `persist(...)` in the worker, so
 * the model and the code cannot silently diverge. The in-memory `AttemptStarted --> Delivering` leg is
 * never persisted, so the committed edges collapse to: a re-claimable row (Pending/Retrying) commits
 * to exactly one of Delivered / Retrying / DeadLettered.
 *
 * This checks the STRUCTURAL protocol (legal edge + the exhaustion rule), which holds even under the
 * deliberate-bug chaos toggles — those produce *semantically* wrong but *structurally legal* commits
 * (e.g. CHAOS_WEBHOOK_DROP_ON_FAIL persists a legal `Delivered`; the at-least-once property catches
 * the semantic violation). So this assertion never fights the chaos demos; it catches a genuinely
 * off-protocol commit (an illegal edge, or a dead-letter before the budget is spent).
 */

const LEGAL_COMMIT: Readonly<Record<string, ReadonlySet<WebhookDeliveryStateName>>> = {
  Pending: new Set<WebhookDeliveryStateName>(['Delivered', 'Retrying', 'DeadLettered']),
  Retrying: new Set<WebhookDeliveryStateName>(['Delivered', 'Retrying', 'DeadLettered']),
}

/**
 * Throw if a committed delivery transition is off-protocol vs WebhookDelivery.tla:
 *  - `from` must be a re-claimable state (Pending/Retrying) with `to` a legal successor; and
 *  - a dead-letter is rejected only when it gives up EARLY (`attempt < maxAttempts`).
 *
 * This second check is a deliberately WEAKER, false-positive-safe projection of the model's
 * `ExhaustionLegit == (attempts = MaxAttempts)` (strict equality): it rejects premature give-up but
 * not `attempt > maxAttempts`. Strict equality would false-throw on a legitimately over-budget row
 * (e.g. a `max_attempts` policy cut applied to an already-in-flight delivery), which the model — where
 * attempts are bounded `0..MaxAttempts` — never represents. So we guard the direction that is always a
 * real bug (premature dead-letter) and leave the over-budget tail to the (unbounded-in-practice) policy.
 */
export function assertLegalDeliveryCommit(
  from: WebhookDeliveryStateName,
  to: WebhookDeliveryStateName,
  attempt: number,
  maxAttempts: number,
): void {
  const allowed = LEGAL_COMMIT[from]
  if (!allowed?.has(to)) {
    throw new Error(
      `illegal webhook-delivery commit ${from} -> ${to} (off WebhookDelivery.tla Next relation)`,
    )
  }
  if (to === 'DeadLettered' && attempt < maxAttempts) {
    throw new Error(
      `premature dead-letter: attempt ${attempt} < maxAttempts ${maxAttempts} (violates ExhaustionLegit)`,
    )
  }
}
