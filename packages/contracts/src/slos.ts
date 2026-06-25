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
