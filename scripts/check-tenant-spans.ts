import { resolve } from 'node:path'
import { foldRunner } from './lib/fold-runner'
import { type AuditSpan, auditSpans } from './lib/tenant-span-audit'

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
 * FALSIFIER MODE (`TENANT_SPAN_SINCE_START=1`): audit only spans that started after this process
 * began, polling Jaeger until fresh spans appear (up to TENANT_SPAN_FRESH_TIMEOUT_MS, default 60s,
 * every TENANT_SPAN_POLL_MS, default 5s). `prove tenant-span-everywhere --break` arms the drop and
 * rolls the pods; the whole-window audit would also see pre-arming spans that still carry tenant.id
 * and, if it ran before fresh spans landed, false-green — which claims:verify then mislabels
 * THEATER (a real load-induced flake observed under a concurrent cold test sweep). Auditing only
 * post-arming spans makes the verdict deterministic: the always-on flags outbox relay emits fresh
 * spans within seconds, so an armed run reliably shows a dropped stamp (red) and a clean run shows a
 * present one (green). The default (no flag) keeps the whole-window behavior the gauntlet needs.
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

// Falsifier mode: audit only spans newer than this process's start. `new Date()` is legitimate
// here — this is build tooling, not the deterministic service runtime (the Clock rule covers the
// latter, as scripts/lib/fold-runner.ts notes).
const sinceStart = process.env.TENANT_SPAN_SINCE_START === '1'
const auditStartMs = Date.now()
const sinceMs = sinceStart ? auditStartMs : null
const freshTimeoutMs = Number(process.env.TENANT_SPAN_FRESH_TIMEOUT_MS ?? '60000')
const pollMs = Number(process.env.TENANT_SPAN_POLL_MS ?? '5000')

interface JaegerTag {
  key: string
  value: unknown
}
interface JaegerSpan {
  operationName: string
  startTime: number
  tags: JaegerTag[]
}
interface JaegerTrace {
  spans: JaegerSpan[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch through a `kubectl port-forward`, which drops the SPDY stream mid-request often enough to
 * flake a gate ("other side closed" / UND_ERR_SOCKET). The forward itself is fine (with-port-forward
 * waited for readiness); a dropped connection just needs a retry, not a red. Retries transport
 * throws AND 5xx (Jaeger briefly 503s while the pod settles) with linear backoff; a real 4xx is not
 * retried. Fails only after the connection stays broken across every attempt.
 */
async function fetchThroughForward(url: string, attempts = 5): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return res
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await sleep(500 * (i + 1))
  }
  throw new Error(`Jaeger unreachable after ${attempts} attempts (${url}): ${String(lastErr)}`)
}

async function collectSpans(): Promise<AuditSpan[]> {
  const spans: AuditSpan[] = []
  for (const service of SERVICES) {
    const res = await fetchThroughForward(
      `${JAEGER}/api/traces?service=${service}&lookback=${LOOKBACK}&limit=${LIMIT}`,
    )
    if (!res.ok) {
      process.stderr.write(`failed to query Jaeger for service=${service}: HTTP ${res.status}\n`)
      process.exit(2)
    }
    const body = (await res.json()) as { data?: JaegerTrace[] }
    for (const trace of body.data ?? []) {
      for (const span of trace.spans) {
        spans.push({
          service,
          operationName: span.operationName,
          startTimeMicros: span.startTime,
          hasTenantId: span.tags.some((t) => t.key === 'tenant.id'),
        })
      }
    }
  }
  return spans
}

// In falsifier mode, wait until fresh (post-start) spans exist before judging, so an audit that
// races ahead of the rolled pods' first spans does not false-green. A whole-window run audits once.
let spans = await collectSpans()
if (sinceStart) {
  const deadline = auditStartMs + freshTimeoutMs
  while (spans.filter((s) => s.startTimeMicros / 1000 >= auditStartMs).length === 0) {
    if (Date.now() >= deadline) {
      process.stderr.write(
        `no spans newer than process start after ${freshTimeoutMs}ms — drive traffic first ` +
          '(falsifier mode needs fresh post-arming spans to audit)\n',
      )
      process.exit(2)
    }
    await sleep(pollMs)
    spans = await collectSpans()
  }
}

const { total, offenders, offenderLabels } = auditSpans(spans, sinceMs)
for (const label of offenderLabels) {
  process.stderr.write(`✗ span without tenant.id: ${label}\n`)
}

if (total === 0) {
  process.stderr.write('no spans found in Jaeger — drive some traffic (smoke flows) first\n')
  process.exit(2)
}

const windowLabel = sinceStart
  ? `since process start (${freshTimeoutMs}ms wait)`
  : `lookback=${LOOKBACK}`
process.stdout.write(
  `checked ${total} spans across ${SERVICES.length} services (${windowLabel}, limit=${LIMIT}/svc); ${offenders} missing tenant.id\n`,
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
      lookback: sinceStart ? 'since-start' : LOOKBACK,
      limit_per_service: LIMIT,
    },
    seeds: {},
  })
  process.stdout.write('merged tenant-spans runner into summary.json\n')
}

process.exit(offenders > 0 ? 1 : 0)
