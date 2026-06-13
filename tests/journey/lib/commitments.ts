import { ProblemDetails } from '@qaroom/contracts'
import type { GatewayResponse } from '@qaroom/testing-utils/live-client'

/**
 * Live commitment checks for the golden journey. Each returns a structured verdict
 * (`{ ok, detail }`) so the test asserts with a single `expect(v.ok, v.detail).toBe(true)` and
 * stays free of conditional logic (a repo convention). These promote invariants that are today
 * only checked in-process (or in the gauntlet epilogue) to assertions made against the REAL
 * cluster, on the traffic this one journey produced.
 *
 * Covered so far:
 *  - RFC 7807 envelope on every non-2xx (Problem Details + the required QARoom extensions).
 *  - Commitment 9: every span carries `tenant.id` (queried from Jaeger, scoped to the journey).
 *
 * Designed-for-next (seams left, asserted once the live run is wired): exactly-once EFFECT under
 * idempotent replay, and state-machine legality end-to-end via the reverse-conformance spans.
 */
export interface Verdict {
  readonly ok: boolean
  readonly detail: string
}

/**
 * Every non-2xx the journey can provoke must be an RFC 7807 Problem Details document. Validated
 * against the canonical `ProblemDetails` Zod schema from `@qaroom/contracts`, so this enforces the
 * closed `failure_domain` enum, the `next_actions` shape, and `retryable` — not just key presence.
 * Call it on responses the journey deliberately makes fail; a naked 500 or a bare `{error}` reds.
 */
export function problemDetailsVerdict(res: GatewayResponse): Verdict {
  if (res.status >= 200 && res.status < 300) {
    return { ok: false, detail: `expected a non-2xx to inspect, got ${res.status}` }
  }
  const parsed = ProblemDetails.safeParse(res.body)
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ')
    return { ok: false, detail: `status ${res.status} body is not RFC 7807: ${where}` }
  }
  return {
    ok: true,
    detail: `RFC 7807 ok (status ${res.status}, failure_domain=${parsed.data.failure_domain})`,
  }
}

interface JaegerTag {
  readonly key: string
}
interface JaegerSpan {
  readonly operationName: string
  readonly tags: readonly JaegerTag[]
}
interface JaegerTrace {
  readonly spans: readonly JaegerSpan[]
}

export interface TenantSpanQuery {
  readonly jaegerUrl: string
  readonly services: readonly string[]
  readonly lookback: string
  readonly limitPerService: number
}

/**
 * Commitment 9, asserted live: after the journey has driven traffic, every span Jaeger holds
 * for the journey's services must carry a `tenant.id` tag. This is the same oracle as
 * `scripts/check-tenant-spans.ts`, narrowed to a per-journey lookback so it reads only this
 * run's spans. Falsifiable: arm `CHAOS_TENANT_SPAN_DROP=1` on a service and this verdict goes
 * red — the in-process detector, now proven against the real distributed trace.
 */
type ServiceScan =
  | { readonly service: string; readonly ok: true; readonly traces: readonly JaegerTrace[] }
  | { readonly service: string; readonly ok: false; readonly error: string }

async function scanService(query: TenantSpanQuery, service: string): Promise<ServiceScan> {
  const url =
    `${query.jaegerUrl}/api/traces?service=${encodeURIComponent(service)}` +
    `&lookback=${query.lookback}&limit=${query.limitPerService}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { service, ok: false, error: `HTTP ${res.status}` }
    const parsed = (await res.json()) as { data?: readonly JaegerTrace[] }
    return { service, ok: true, traces: parsed.data ?? [] }
  } catch (error) {
    return { service, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function tenantSpansVerdict(query: TenantSpanQuery): Promise<Verdict> {
  // The per-service Jaeger queries are independent — fan out concurrently rather than paying one
  // round-trip per service in series. The verdict aggregates regardless of which returns first.
  const scans = await Promise.all(query.services.map((service) => scanService(query, service)))

  const failed = scans.find((s) => !s.ok)
  if (failed && !failed.ok) {
    return { ok: false, detail: `Jaeger query failed for ${failed.service}: ${failed.error}` }
  }

  let checked = 0
  const offenders: string[] = []
  for (const scan of scans) {
    if (!scan.ok) continue
    for (const trace of scan.traces) {
      for (const span of trace.spans) {
        checked += 1
        const hasTenant = span.tags.some((t) => t.key === 'tenant.id')
        if (!hasTenant) offenders.push(`${scan.service} :: ${span.operationName}`)
      }
    }
  }
  if (checked === 0) {
    return { ok: false, detail: 'no spans in Jaeger for the journey window — did traffic run?' }
  }
  return {
    ok: offenders.length === 0,
    detail:
      offenders.length === 0
        ? `${checked} spans, all carry tenant.id`
        : `${offenders.length}/${checked} spans missing tenant.id: ${offenders.slice(0, 5).join('; ')}`,
  }
}
