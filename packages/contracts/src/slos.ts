/**
 * Service Level Objectives — the single in-code source of truth for the latency / error targets
 * that k6 enforces in Milestone 8. Mirrors the table in `docs/slos.md`; `slos.test.ts` pins the two
 * equal so the prose doc and the load gate cannot drift. k6 cannot
 * import TypeScript, so `scripts/k6-gen-thresholds.ts` projects these into `load-tests/lib/*.gen.json`.
 *
 * Teaching values, not production claims (see `docs/slos.md`). `latencyMs: null` means deliberately
 * unbounded; `availability: null` means best-effort.
 */

export interface LatencyTargetMs {
  readonly p50: number
  readonly p95: number
  readonly p99: number
}

export interface SloTarget {
  /** The route template exactly as written in `docs/slos.md` (so the drift test can match rows). */
  readonly route: string
  readonly method: 'GET' | 'POST'
  /** Latency percentiles in milliseconds, or `null` when deliberately unbounded. */
  readonly latencyMs: LatencyTargetMs | null
  /** Maximum acceptable error rate as a fraction (0.005 = 0.5%). */
  readonly errorRate: number
  /** Availability as a fraction, or `null` for best-effort. */
  readonly availability: number | null
}

export const SLO_TARGETS = {
  createPost: {
    route: 'POST /api/communities/{id}/posts',
    method: 'POST',
    latencyMs: { p50: 50, p95: 200, p99: 500 },
    errorRate: 0.005,
    availability: 0.99,
  },
  feed: {
    route: 'GET /api/communities/{id}/feed',
    method: 'GET',
    latencyMs: { p50: 30, p95: 100, p99: 300 },
    errorRate: 0.001,
    availability: 0.99,
  },
  castVote: {
    route: 'POST /api/posts/{id}/votes',
    method: 'POST',
    latencyMs: { p50: 40, p95: 150, p99: 400 },
    errorRate: 0.01,
    availability: 0.99,
  },
  donation: {
    route: 'POST /api/communities/{id}/donations',
    method: 'POST',
    latencyMs: { p50: 200, p95: 800, p99: 2000 },
    errorRate: 0.01,
    availability: 0.99,
  },
  systemState: {
    route: 'GET /system/state',
    method: 'GET',
    latencyMs: { p50: 20, p95: 80, p99: 200 },
    errorRate: 0.001,
    availability: 0.99,
  },
  snapshot: {
    route: 'GET /system/snapshot',
    method: 'GET',
    latencyMs: null,
    errorRate: 0.01,
    availability: null,
  },
} as const satisfies Record<string, SloTarget>

export type SloKey = keyof typeof SLO_TARGETS

/** The k6-facing endpoints (Milestone 8 focus: vote write-heavy, feed read-heavy, donation flow). */
export const K6_ENDPOINTS = [
  'createPost',
  'feed',
  'castVote',
  'donation',
] as const satisfies readonly SloKey[]

/** The endpoints the Prometheus alert rules cover (write-heavy + read-heavy representatives). A
 *  documented SAMPLE, the way K6_ENDPOINTS is a subset — `scripts/gen-alert-rules.ts` projects each
 *  into an error-rate + p95-latency alert (ADR-0034). */
export const ALERT_ENDPOINTS = ['createPost', 'feed'] as const satisfies readonly SloKey[]

/**
 * The async consumer-lag SLO (ADR-0034): the backpressure target for every durable JetStream
 * consumer. `SLO_TARGETS` above bounds the *synchronous* request path; this bounds the
 * *asynchronous* one — a consumer that falls behind (the moderator under a burst, the webhooks
 * fan-out behind a slow receiver) had no defined failure mode without it. Like `SLO_TARGETS`, this is
 * the SINGLE source: `scripts/gen-alert-rules.ts` projects it into the Prometheus alert thresholds
 * (the `k6:gen` one-source pattern), and the runtime breach check {@link evaluateConsumerLag} derives
 * from it too, so the alert and the in-process gate can never disagree on the bound. Teaching values,
 * not production claims (mirrors `docs/slos.md`). Applied PER durable consumer.
 */
export interface ConsumerLagSlo {
  /** Max `num_pending` (undelivered backlog) a durable may accumulate before the SLO is breached. */
  readonly maxPending: number
  /** Max age (ms) of the oldest unacknowledged message before the SLO is breached. */
  readonly maxAckAgeMs: number
}

/** A point-in-time lag reading for one durable consumer (the JetStream ConsumerInfo subset we gate). */
export interface ConsumerLag {
  /** `num_pending`: stream messages this consumer has not yet delivered+acked. */
  readonly numPending: number
  /** `num_ack_pending`: delivered-but-unacked, in flight. */
  readonly numAckPending: number
  /** `num_redelivered`: messages redelivered at least once (retry pressure). */
  readonly numRedelivered: number
  /** Age (ms) of the oldest unacknowledged message; 0 when the consumer is caught up. */
  readonly oldestUnackedAgeMs: number
}

export const CONSUMER_LAG_SLO = {
  maxPending: 1000,
  maxAckAgeMs: 30_000,
} as const satisfies ConsumerLagSlo

export interface ConsumerLagVerdict {
  readonly breached: boolean
  /** One reason per breached dimension; empty when within the SLO. */
  readonly breaches: readonly string[]
}

/**
 * Pure backpressure check: is a consumer's lag within the SLO? Both the Prometheus alert rules
 * (`scripts/gen-alert-rules.ts`) and the in-process backpressure gate derive their threshold from the
 * SAME `slo`, so a stalled consumer that breaches the alert also reds the gate — one bound, two
 * projections (the verifiable-invariants discipline, ADR-0024 / ADR-0034). No I/O, no clock.
 */
export function evaluateConsumerLag(
  lag: ConsumerLag,
  slo: ConsumerLagSlo = CONSUMER_LAG_SLO,
): ConsumerLagVerdict {
  const breaches = [
    lag.numPending > slo.maxPending
      ? `num_pending ${lag.numPending} exceeds maxPending ${slo.maxPending}`
      : null,
    lag.oldestUnackedAgeMs > slo.maxAckAgeMs
      ? `oldest-unacked age ${lag.oldestUnackedAgeMs}ms exceeds maxAckAgeMs ${slo.maxAckAgeMs}ms`
      : null,
  ].filter((b): b is string => b !== null)
  return { breached: breaches.length > 0, breaches }
}
