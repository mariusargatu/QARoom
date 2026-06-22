/**
 * Pure audit core for the live tenant.id span gate (Commitment 9), extracted from
 * `scripts/check-tenant-spans.ts` so the offender-counting and the freshness filter are unit
 * testable without a live Jaeger.
 *
 * The freshness filter exists to de-flake the live FALSIFIER. `prove tenant-span-everywhere
 * --break` arms `CHAOS_TENANT_SPAN_DROP`, rolls the pods, then audits — but the audit window also
 * contains pre-arming spans that still carry tenant.id. If the audit runs before fresh (post-roll)
 * spans land, it sees only clean stale spans, reports 0 offenders, and the gate false-greens — which
 * `claims:verify` then mislabels THEATER. Auditing only spans newer than the arm time makes the
 * verdict deterministic: a clean run shows fresh STAMPED spans (green), an armed run shows fresh
 * UNSTAMPED spans (red). Jaeger span `startTime` is microseconds since the epoch.
 */
export interface AuditSpan {
  service: string
  operationName: string
  /** Jaeger span start time, microseconds since the epoch. */
  startTimeMicros: number
  hasTenantId: boolean
}

export interface AuditResult {
  total: number
  offenders: number
  offenderLabels: string[]
}

/** A span counts when no freshness cutoff is set, or it started at/after the cutoff. */
export const spanIsFresh = (startTimeMicros: number, sinceMs: number | null): boolean =>
  sinceMs === null || startTimeMicros / 1000 >= sinceMs

/**
 * Count spans missing tenant.id among those passing the freshness cutoff. `sinceMs === null`
 * audits every span (the default whole-window gauntlet behavior); a numeric cutoff audits only
 * post-cutoff spans (the falsifier's deterministic mode).
 */
export function auditSpans(spans: AuditSpan[], sinceMs: number | null): AuditResult {
  const fresh = spans.filter((s) => spanIsFresh(s.startTimeMicros, sinceMs))
  const offenders = fresh.filter((s) => !s.hasTenantId)
  return {
    total: fresh.length,
    offenders: offenders.length,
    offenderLabels: offenders.map((s) => `${s.service} :: ${s.operationName}`),
  }
}
