import { findPiiInAttributes } from '@qaroom/otel/pii'

/**
 * Tier-B live audit (ADR-0034): sweep recent Jaeger traces and FAIL if any span attribute carries
 * PII (an email-shaped value, or a denied body/identifier key). The inverse of
 * `scripts/check-tenant-spans.ts`: that gate proves every span carries `tenant.id`; this proves no
 * span carries a user's email or post body. Both share the freshness/service-sweep shape; both reach
 * Jaeger only on a running cluster, so this is Tier-B — named, runnable on the cluster, deferred per
 * PR. The IN-PROCESS teeth (the `pii-free-spans` claim) live in @qaroom/otel and run keyless on every
 * PR; this is the corroborating live audit (the same primary/corroboration split as ADR-0028).
 *
 * Falsifiable via CHAOS_SPAN_PII=1 on the target services (packages/otel PiiLeakProbe): armed, a span
 * reaches Jaeger carrying `user.email`, and this gate MUST go red.
 *
 *   JAEGER_QUERY_URL   Jaeger query base (default http://localhost:16686)
 *   PII_SPAN_SERVICES  csv of Jaeger service names (default: the six TS backends)
 *   PII_SPAN_LOOKBACK  Jaeger lookback window (default 1h)
 *   PII_SPAN_LIMIT     traces per service (default 50)
 */
const JAEGER = process.env.JAEGER_QUERY_URL ?? 'http://localhost:16686'
const SERVICES = (
  process.env.PII_SPAN_SERVICES ?? 'gateway,content,identity,flags,donations,webhooks'
)
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
const LOOKBACK = process.env.PII_SPAN_LOOKBACK ?? '1h'
const LIMIT = Number(process.env.PII_SPAN_LIMIT ?? '50')

interface JaegerTag {
  key: string
  value: unknown
}
interface JaegerSpan {
  operationName: string
  tags: JaegerTag[]
}
interface JaegerTrace {
  spans: JaegerSpan[]
}

interface Offender {
  service: string
  operationName: string
  keys: string[]
}

async function collectOffenders(): Promise<{ total: number; offenders: Offender[] }> {
  const offenders: Offender[] = []
  let total = 0
  for (const service of SERVICES) {
    const res = await fetch(
      `${JAEGER}/api/traces?service=${service}&lookback=${LOOKBACK}&limit=${LIMIT}`,
    )
    if (!res.ok) {
      process.stderr.write(`failed to query Jaeger for service=${service}: HTTP ${res.status}\n`)
      process.exit(2)
    }
    const body = (await res.json()) as { data?: JaegerTrace[] }
    for (const trace of body.data ?? []) {
      for (const span of trace.spans) {
        total += 1
        const attrs = Object.fromEntries(span.tags.map((t) => [t.key, t.value]))
        const keys = findPiiInAttributes(attrs)
        if (keys.length > 0) offenders.push({ service, operationName: span.operationName, keys })
      }
    }
  }
  return { total, offenders }
}

const { total, offenders } = await collectOffenders()
for (const o of offenders) {
  process.stderr.write(`✗ PII on span: ${o.service} :: ${o.operationName} — ${o.keys.join(', ')}\n`)
}

if (total === 0) {
  process.stderr.write('no spans found in Jaeger — drive some traffic (smoke flows) first\n')
  process.exit(2)
}

process.stdout.write(
  `checked ${total} spans across ${SERVICES.length} services (lookback=${LOOKBACK}, limit=${LIMIT}/svc); ${offenders.length} carrying PII\n`,
)
process.exit(offenders.length > 0 ? 1 : 0)
