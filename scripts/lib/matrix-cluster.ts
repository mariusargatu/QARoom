import { spawnSync } from 'node:child_process'
import type { ToggleGuard } from './manifests/detection-matrix'
import type { MatrixCell } from './manifests/detection-matrix-schema'

/**
 * Tier B of the detection matrix: arm one toggle on the LIVE deployment(s) via
 * scripts/live-toggle.sh (kubectl set env → rollout → battery → guaranteed revert), run the
 * live-technique battery, record caught/missed per technique from exit codes.
 *
 * Verdict semantics differ from Tier A by necessity: there is no per-file baseline diff on a
 * live cluster — the baseline is "this battery is green on a clean cluster", which the
 * gauntlet's phases 4–5 establish on the same cluster right before any Tier B row runs.
 * A non-zero battery-step exit under the armed toggle = caught (k6's SLO-breach exit 99
 * included); zero = missed.
 *
 * macOS networking: k6/Schemathesis containers reach port-forwards via host.docker.internal.
 */
const PF = 'bash scripts/with-port-forward.sh'
const K6 = 'docker run --rm -v "$PWD":/work -w /work grafana/k6 run'
const TT = 'TRACETEST_SERVER_URL=http://localhost:11633'

interface BatteryStep {
  technique: string
  cmd: string
  timeoutMs?: number
}
export interface ClusterRow {
  /** deployments (ns qaroom) the toggle must be armed on, comma-joined for live-toggle.sh */
  deployments: string
  steps: BatteryStep[]
  notes?: string
}

const SMOKE: BatteryStep = { technique: 'smoke', cmd: 'pnpm smoke' }
const TENANT_SPANS: BatteryStep = {
  technique: 'tenant-spans',
  cmd: `${PF} observability/qaroom-jaeger:16686:16686 -- env JAEGER_QUERY_URL=http://localhost:16686 TENANT_SPAN_LOOKBACK=15m pnpm check:tenant-spans`,
}
const k6Step = (script: string, svc: string, port: number, baseEnv: string): BatteryStep => ({
  technique: 'k6',
  cmd: `${PF} ${svc}:${port}:80 -- ${K6} load-tests/${script}.js -e ${baseEnv}=http://host.docker.internal:${port} -e K6_SLO_MULTIPLIER=3`,
  timeoutMs: 15 * 60_000,
})
const schemathesisStep = (spec: string, svc: string, port: number): BatteryStep => ({
  technique: 'schemathesis',
  // Paced under the gateway limiter's refill — unpaced, the fuzzer's own 429s read as failures
  // (the gauntlet's interference finding) and every gateway-target cell would false-catch.
  cmd: `${PF} ${svc}:${port}:80 -- env SCHEMATHESIS_RATE_LIMIT=8/s bash scripts/schemathesis-gate.sh ${spec} http://host.docker.internal:${port} 25`,
  timeoutMs: 20 * 60_000,
})
const tracetestStep = (...defs: string[]): BatteryStep => {
  // The rollout-transition def consumes one machine edge per run — reset to Off first or a row
  // late in the sweep red-flags on edge exhaustion (a 409'd trigger → missing spans), not on
  // its toggle. The reset rides the same cell so per-cell exit semantics stay one command.
  const reset = defs.some((d) => d.includes('rollout-transition'))
    ? `${PF} flags:18083:80 -- bash scripts/reset-rollout.sh http://localhost:18083 && `
    : ''
  return {
    technique: 'tracetest',
    cmd: `${reset}${PF} observability/qaroom-tracetest:11633:11633 -- env ${TT} pnpm tracetest:results ${defs.join(' ')}`,
    timeoutMs: 15 * 60_000,
  }
}

/** The battery each cluster-tier toggle row runs. Bespoke per row — the techniques that could
 *  plausibly see the bug run as cells; knowably-irrelevant ones are blindness probes on purpose. */
export const CLUSTER_ROWS: Record<string, ClusterRow> = {
  'tenant-span-drop': {
    deployments: 'content,gateway,identity,flags,donations,webhooks',
    steps: [SMOKE, tracetestStep('services/content/tests/tracetest/feed-read.yaml'), TENANT_SPANS],
    notes: 'Expected: only the tenant-span audit goes red — the claim candidate.',
  },
  'feed-reversed': {
    deployments: 'content',
    steps: [
      SMOKE,
      k6Step('feed', 'content', 18081, 'CONTENT_BASE_URL'),
      schemathesisStep('services/content', 'content', 18081),
      tracetestStep('services/content/tests/tracetest/feed-read.yaml'),
    ],
    notes:
      'The blindness-probe row: every live technique is order-blind by construction — smoke ' +
      'checks health, k6 checks latency, Schemathesis checks schema, Tracetest checks trace ' +
      'shape. Expected all-miss; the in-proc feed-order spec is the only detector.',
  },
  'vote-slow': {
    deployments: 'content',
    steps: [SMOKE, k6Step('vote-cast', 'content', 18081, 'CONTENT_BASE_URL')],
    notes: 'Expected: k6 exit 99 (SLO breach) = caught; smoke stays green (health ≠ speed).',
  },
  'sync-publish': {
    deployments: 'content',
    steps: [
      k6Step('vote-cast', 'content', 18081, 'CONTENT_BASE_URL'),
      {
        technique: 'chaos',
        cmd: 'K6_SLO_MULTIPLIER=3 bash scripts/k6-under-chaos.sh 02-net-slow-nats vote-cast',
        timeoutMs: 20 * 60_000,
      },
    ],
    notes:
      'The composition-only bug: plain k6 (healthy broker) expected GREEN even with the toggle ' +
      'armed; k6-under-chaos (slow NATS × load) expected RED. Caught by the composition cell only.',
  },
  'canary-misroutes': {
    deployments: 'flags',
    steps: [
      SMOKE,
      { technique: 'mbt-live', cmd: 'bash scripts/live-rollout-tour.sh', timeoutMs: 10 * 60_000 },
      tracetestStep('services/flags/tests/tracetest/rollout-transition.yaml'),
    ],
    notes:
      'node-env-gated (registry guard field): live cells auto-derive to n/a — deployed pods run ' +
      'NODE_ENV=production, so the armed toggle is inert. The steps document what would run.',
  },
  'disable-circuit-breaker': {
    deployments: 'gateway',
    steps: [SMOKE, schemathesisStep('services/gateway', 'gateway', 18090)],
    notes:
      'With healthy upstreams the missing breaker is invisible (the in-proc lesson, live) — ' +
      'expected all-miss unless a fuzzed route hits a sick upstream during the run.',
  },
  'upstream-timeout': {
    deployments: 'gateway',
    steps: [SMOKE, schemathesisStep('services/gateway', 'gateway', 18090)],
    notes:
      'Needs a hanging upstream to bite; the chaos 07 partition experiment is the real ' +
      'detector and runs in the gauntlet chaos phase, not per-row (5 min fault window).',
  },
  'webhook-illegal-transition': {
    deployments: 'webhooks',
    steps: [
      SMOKE,
      tracetestStep('services/webhooks/tests/tracetest/webhook-create-coherent-trace.yaml'),
    ],
    notes: 'H7: does live Tracetest reverse-conformance add detection beyond the in-proc spec?',
  },
  'skip-dedup': {
    deployments: 'flags,donations,webhooks',
    steps: [
      SMOKE,
      tracetestStep(
        'services/donations/tests/tracetest/donation-create-publish.yaml',
        'services/flags/tests/tracetest/rollout-transition.yaml',
      ),
    ],
    notes:
      'Live dedup loss only shows under REDELIVERY, which needs broker disturbance — the chaos ' +
      '03 experiment is the designated live detector; this row records what calm traffic sees.',
  },
}

export interface ClusterCellInput {
  toggleId: string
  env: { name: string; value: string }
  guard: ToggleGuard
  commit: string
  recordedAt: string
}

/** Run one Tier B row: per-step arm → run → revert (live-toggle.sh around EACH battery step).
 *  Costs rollout churn (~30s/step on k3d) but keeps every cell's verdict a single exit code and
 *  guarantees no cross-step contamination — a revert sits between techniques. */
export function runClusterRow(root: string, input: ClusterCellInput): MatrixCell[] {
  const row = CLUSTER_ROWS[input.toggleId]
  if (!row) return []
  // Auto-derived n/a: a node-env-gated read site ignores the env var when NODE_ENV=production,
  // which every deployed pod runs — arming it live would burn rollouts on an inert toggle.
  // Driven by the registry's census-verified guard field, never a per-row operator note.
  if (input.guard === 'node-env-gated') {
    process.stdout.write(
      '    · node-env-gated — live cells derived n/a (toggle inert under NODE_ENV=production)\n',
    )
    return row.steps.map((step) => ({
      toggle: input.toggleId,
      technique: step.technique,
      tier: 'cluster',
      status: 'na',
      commit: input.commit,
      recorded_at: input.recordedAt,
      duration_ms: 0,
      evidence: {
        newly_failing: [],
        justification:
          `node-env-gated read site: ${input.env.name} is ignored when NODE_ENV=production, ` +
          'which the deployed pods run',
      },
    }))
  }
  const cells: MatrixCell[] = []
  for (const step of row.steps) {
    process.stdout.write(`    · [${step.technique}] under ${input.env.name}=${input.env.value}\n`)
    const started = Date.now()
    const run = spawnSync(
      'bash',
      [
        'scripts/live-toggle.sh',
        row.deployments,
        `${input.env.name}=${input.env.value}`,
        '--',
        'bash',
        '-c',
        step.cmd,
      ],
      { cwd: root, encoding: 'utf8', timeout: step.timeoutMs ?? 10 * 60_000 },
    )
    // live-toggle exit = the gate's exit (3 = revert failure — abort everything, a leaked
    // toggle poisons every later row).
    if (run.status === 3) {
      process.stderr.write(`✗ REVERT FAILED on ${input.toggleId}/${step.technique} — aborting\n`)
      process.stderr.write(`${(run.stderr ?? '').split('\n').slice(-5).join('\n')}\n`)
      process.exit(3)
    }
    const caught = run.status !== 0
    cells.push({
      toggle: input.toggleId,
      technique: step.technique,
      tier: 'cluster',
      status: caught ? 'caught' : 'missed',
      commit: input.commit,
      recorded_at: input.recordedAt,
      duration_ms: Date.now() - started,
      evidence: {
        newly_failing: caught ? [`live:${step.technique} (exit ${run.status})`] : [],
      },
    })
    process.stdout.write(
      `    ${caught ? '✓ caught' : '✗ missed'} — ${step.technique} exit ${run.status}\n`,
    )
  }
  return cells
}
