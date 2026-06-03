/**
 * Milestone 3 exit criterion: scan recent traces and FAIL if any span lacks `tenant.id`
 * (Commitment 9 — every span carries the tenancy discriminator). Queries the Jaeger v2
 * HTTP API after smoke flows have run against the live cluster. Run via
 * `pnpm check:tenant-spans` with Jaeger reachable (Tilt port-forwards it on :16686).
 */
const JAEGER = process.env.JAEGER_QUERY_URL ?? 'http://localhost:16686'
const SERVICES = ['gateway', 'content', 'identity']

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

for (const service of SERVICES) {
  const res = await fetch(`${JAEGER}/api/traces?service=${service}&lookback=1h&limit=50`)
  if (!res.ok) {
    process.stderr.write(`failed to query Jaeger for service=${service}: HTTP ${res.status}\n`)
    process.exit(2)
  }
  const body = (await res.json()) as { data?: JaegerTrace[] }
  const traces = body.data ?? []
  for (const trace of traces) {
    for (const span of trace.spans) {
      total += 1
      const hasTenant = span.tags.some((t) => t.key === 'tenant.id')
      if (!hasTenant) {
        offenders += 1
        process.stderr.write(`✗ span without tenant.id: ${service} :: ${span.operationName}\n`)
      }
    }
  }
}

if (total === 0) {
  process.stderr.write('no spans found in Jaeger — drive some traffic (smoke flows) first\n')
  process.exit(2)
}

process.stdout.write(
  `checked ${total} spans across ${SERVICES.length} services; ${offenders} missing tenant.id\n`,
)
process.exit(offenders > 0 ? 1 : 0)
