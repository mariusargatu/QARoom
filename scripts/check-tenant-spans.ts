import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'

/**
 * Milestone 3 exit criterion: scan recent traces and FAIL if any span lacks `tenant.id`
 * (Commitment 9 — every span carries the tenancy discriminator). Queries the Jaeger v2
 * HTTP API after traffic has run against the live cluster. Run via
 * `pnpm check:tenant-spans` with Jaeger reachable (Tilt port-forwards it on :16686).
 *
 * Parameterized for the gauntlet epilogue, where EVERY technique's cluster traffic (smoke, MBT
 * tour, k6, Schemathesis, chaos probes) becomes tenancy-isolation test data for free:
 *
 *   TENANT_SPAN_SERVICES  csv of Jaeger service names (default: all six TS backends — flags,
 *                         donations, webhooks were never held to this gate before; a new
 *                         offender there is a genuine find, not noise)
 *   TENANT_SPAN_LOOKBACK  Jaeger lookback window (default 1h; a full gauntlet needs more)
 *   TENANT_SPAN_LIMIT     traces per service (default 50; a full battery needs more)
 *   --fold                also fold a `tenant-spans` runner into test-results/summary.json
 *
 * Falsifiable via CHAOS_TENANT_SPAN_DROP=1 on the target services (packages/otel
 * tenant-span-processor): with the stamp dropped, this gate MUST go red.
 */
const JAEGER = process.env.JAEGER_QUERY_URL ?? 'http://localhost:16686'
const SERVICES = (
  process.env.TENANT_SPAN_SERVICES ?? 'gateway,content,identity,flags,donations,webhooks'
)
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
const LOOKBACK = process.env.TENANT_SPAN_LOOKBACK ?? '1h'
const LIMIT = Number(process.env.TENANT_SPAN_LIMIT ?? '50')
const fold = process.argv.includes('--fold')

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

let total = 0
let offenders = 0
const perService: { service: string; spans: number; offenders: number }[] = []

for (const service of SERVICES) {
  const res = await fetch(
    `${JAEGER}/api/traces?service=${service}&lookback=${LOOKBACK}&limit=${LIMIT}`,
  )
  if (!res.ok) {
    process.stderr.write(`failed to query Jaeger for service=${service}: HTTP ${res.status}\n`)
    process.exit(2)
  }
  const body = (await res.json()) as { data?: JaegerTrace[] }
  const traces = body.data ?? []
  let serviceSpans = 0
  let serviceOffenders = 0
  for (const trace of traces) {
    for (const span of trace.spans) {
      serviceSpans += 1
      const hasTenant = span.tags.some((t) => t.key === 'tenant.id')
      if (!hasTenant) {
        serviceOffenders += 1
        process.stderr.write(`✗ span without tenant.id: ${service} :: ${span.operationName}\n`)
      }
    }
  }
  total += serviceSpans
  offenders += serviceOffenders
  perService.push({ service, spans: serviceSpans, offenders: serviceOffenders })
}

if (total === 0) {
  process.stderr.write('no spans found in Jaeger — drive some traffic (smoke flows) first\n')
  process.exit(2)
}

process.stdout.write(
  `checked ${total} spans across ${SERVICES.length} services (lookback=${LOOKBACK}, limit=${LIMIT}/svc); ${offenders} missing tenant.id\n`,
)

if (fold) {
  foldRunner(resolve(process.cwd(), 'test-results/summary.json'), {
    name: 'tenant-spans',
    passed: offenders === 0 ? 1 : 0,
    failed: offenders > 0 ? 1 : 0,
    skipped: 0,
    duration_ms: 0,
    output: {
      runner: 'jaeger-tenant-span-audit',
      total_spans: total,
      offenders,
      lookback: LOOKBACK,
      limit_per_service: LIMIT,
      services: perService,
    },
    seeds: {},
  })
  process.stdout.write('merged tenant-spans runner into summary.json\n')
}

process.exit(offenders > 0 ? 1 : 0)
