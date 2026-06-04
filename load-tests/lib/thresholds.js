// Build k6 thresholds from the generated SLO projection (scripts/k6-gen-thresholds.ts ← SLO_TARGETS).
// A breached threshold makes k6 exit 99 (ThresholdsHaveFailed) — the load gate's enforcement.
const ENV = typeof __ENV !== 'undefined' ? __ENV : {}

export function measureThresholds(slo, key) {
  const t = slo.endpoints[key]
  const m = Number(ENV.K6_SLO_MULTIPLIER || 1)
  // Thresholds apply only to the `measure` scenario so warm-up samples don't pollute percentiles.
  const th = { 'http_req_failed{scenario:measure}': [`rate<${t.errorRate}`] }
  if (t.latencyMs) {
    // Gate on http_req_waiting (TTFB = server processing time), not http_req_duration: the
    // deliberate slow-path delay lands in the server's response time, while send/receive noise
    // (which co-varies with the CI runner, not the service) is excluded (M8 anti-flake, ADR-0016).
    th['http_req_waiting{scenario:measure}'] = [
      `p(50)<${Math.round(t.latencyMs.p50 * m)}`,
      `p(95)<${Math.round(t.latencyMs.p95 * m)}`,
      `p(99)<${Math.round(t.latencyMs.p99 * m)}`,
    ]
  }
  return th
}
