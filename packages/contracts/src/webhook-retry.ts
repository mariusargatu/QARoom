import type { Randomness } from '@qaroom/determinism'

/**
 * The webhook retry contract (Milestone 11, ADR-0019). Outbound delivery is at-least-once: a
 * failed POST is retried on an exponential, capped, full-jittered backoff until it succeeds or
 * the attempt budget is exhausted (→ dead-letter). This schedule is THE contract subscribers
 * rely on, so it is a pure, deterministic function — jitter comes only from injected
 * `Randomness` (Commitment 6), never `Math.random()` — and is exposed via `/system/capabilities`
 * and observable per-delivery via `attempt`/`next_attempt_at`. It is the milestone's primary
 * property-test target (monotone-before-cap, capped, bounded attempts, seed-determined).
 */

export interface WebhookRetryPolicy {
  /** Delay for the first retry, before jitter (ms). */
  readonly base_delay_ms: number
  /** Exponential growth factor per attempt. */
  readonly multiplier: number
  /** Hard ceiling on the pre-jitter delay (ms). */
  readonly max_delay_ms: number
  /** Total delivery attempts before dead-lettering (attempts 1..max_attempts). */
  readonly max_attempts: number
  /** Jitter strategy applied to the capped exponential delay. */
  readonly jitter: 'full'
}

/**
 * The frozen default retry policy. Surfaced to subscribers so the contract is knowable. The 30s
 * ceiling bites at attempts 6–7 (1000·2^5 = 32s > 30s), so the cap is load-bearing within the
 * attempt budget — not vestigial.
 */
export const WEBHOOK_RETRY_POLICY: WebhookRetryPolicy = {
  base_delay_ms: 1_000,
  multiplier: 2,
  max_delay_ms: 30_000, // 30s ceiling
  max_attempts: 8,
  jitter: 'full',
}

/**
 * The capped exponential ceiling for the retry that follows `attempt` (1-based, the attempt
 * that just failed): `min(base * multiplier^(attempt-1), max_delay_ms)`. Pure and jitter-free,
 * so the exponential/cap properties can be asserted without randomness.
 */
export function backoffCeilingMs(
  attempt: number,
  policy: WebhookRetryPolicy = WEBHOOK_RETRY_POLICY,
): number {
  const exp = policy.base_delay_ms * policy.multiplier ** (attempt - 1)
  return Math.min(exp, policy.max_delay_ms)
}

/**
 * Delay (ms) until the next attempt after `attempt` failed, or `null` when the attempt budget
 * is exhausted (the caller dead-letters). Full jitter: a uniform draw in `[0, ceiling]` from the
 * injected `Randomness`, so identical seeds yield identical schedules and the delay never exceeds
 * `max_delay_ms`. `attempt` is 1-based (the attempt that just failed).
 */
export function nextBackoff(
  attempt: number,
  randomness: Randomness,
  policy: WebhookRetryPolicy = WEBHOOK_RETRY_POLICY,
): number | null {
  if (attempt >= policy.max_attempts) return null
  return Math.floor(randomness.next() * backoffCeilingMs(attempt, policy))
}
