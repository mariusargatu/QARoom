import type { GauntletStep } from './gauntlet-steps'

/**
 * The gauntlet plan as data: which step runs in which phase, under which failure class, with
 * which skip conditions. scripts/gauntlet.ts owns preflight + execution; this file owns WHAT
 * runs. Phases 1–2 are the no-cluster lanes (Session 1); phases 3–9 (cluster, fuzzing, chaos,
 * compositions, aftermath, report) land with the cluster wiring session.
 */
export interface PreflightCtx {
  hasDocker: boolean
  hasK3d: boolean
  hasTilt: boolean
  hasKubectl: boolean
  hasHelm: boolean
  hasJava: boolean
  hasTracetest: boolean
  hasUv: boolean
  hasOpenAIKey: boolean
}

export interface GauntletOpts {
  pyrit: boolean
  triangulate: boolean
  reuseCluster: boolean
  down: boolean
}

export const PHASE_TITLES: Record<number, string> = {
  1: 'Fast lane (in-proc, serial)',
  2: 'Mutation ∥ LLM evals (concurrent lanes)',
  3: 'Cluster up (k3d + Tilt + Chaos Mesh)',
  4: 'Pristine baseline (capture before pollution)',
  5: 'Load, clean (exclusive slot — keep the host quiet)',
  6: 'Fuzzing (pollutes state; after baseline + clean k6)',
  7: 'Chaos + deliberate compositions',
  8: 'Aftermath, recovery, triangulation',
  9: 'Report',
}

// Shared invocation fragments for the cluster phases. k6 runs from its container against
// port-forwarded Services via host.docker.internal — NOT --network host, which cannot reach the
// host loopback on macOS (the CI lane runs on Linux and can).
const K6_DOCKER = 'docker run --rm -v "$PWD":/work -w /work grafana/k6 run'
const PF = 'bash scripts/with-port-forward.sh'
const SNAPSHOT_FORWARDS = 'content:18081:80,identity:18082:80,flags:18083:80,donations:18084:80'
const TRACETEST_FWD = 'observability/qaroom-tracetest:11633:11633'
const JAEGER_FWD = 'observability/qaroom-jaeger:16686:16686'
const TRACETEST_ENV = { TRACETEST_SERVER_URL: 'http://localhost:11633' }
const JAEGER_ENV = { JAEGER_QUERY_URL: 'http://localhost:16686' }

const MOD = 'services/moderator-agent'

export function buildPlan(ctx: PreflightCtx, opts: GauntletOpts): GauntletStep[] {
  const phase1: GauntletStep[] = [
    // MUST run first: aggregate-test-results.ts rewrites the summary envelope from scratch,
    // dropping any previously folded runner. Every fold below depends on this ordering.
    step(1, 'aggregate-vitest', 'gate', 'pnpm', ['test-results:generate'], {
      timeoutMs: 25 * 60_000,
    }),
    step(1, 'fold-mbt-coverage', 'gate', 'pnpm', ['mbt:results']),
    // Re-runs the per-service fault-scenario catalogs and folds a `scenario:<svc>` runner. After
    // aggregate-vitest (which rewrites the envelope from scratch), like every other fold here.
    step(1, 'fold-scenario', 'gate', 'pnpm', ['scenario:results']),
    step(1, 'verify-openapi', 'gate', 'pnpm', ['openapi:verify']),
    step(1, 'verify-asyncapi', 'gate', 'pnpm', ['asyncapi:verify']),
    step(1, 'verify-mcp-manifest', 'gate', 'pnpm', ['mcp:verify']),
    step(1, 'pact-providers', 'gate', 'pnpm', ['pact:results'], { timeoutMs: 20 * 60_000 }),
    step(1, 'moderator-pytest', 'gate', 'uv', ['run', 'pytest', '-q'], {
      cwd: MOD,
      skipReason: ctx.hasUv ? undefined : 'uv not installed',
    }),
    step(1, 'fold-moderator', 'gate', 'pnpm', ['moderator:results'], {
      skipReason: ctx.hasUv ? undefined : 'uv not installed',
    }),
    step(1, 'web-stories-coverage', 'gate', 'pnpm', [
      '--filter',
      '@qaroom/web',
      'run',
      'test:stories:coverage',
    ]),
    // Every atomic-design component has a CSF-factory story (ADR-0027 census gate).
    step(1, 'web-census', 'gate', 'pnpm', ['--filter', '@qaroom/web', 'run', 'census']),
    // Screenplay component tests in Vitest browser mode (ADR-0027, replaces the Playwright-CT lane).
    // Runs WITH coverage so the V8 of code only the *.browser.test.tsx tests exercise folds as the
    // `coverage:web-component` runner (coverage-results.ts) — same run still emits component.json.
    step(1, 'web-component', 'gate', 'pnpm', [
      '--filter',
      '@qaroom/web',
      'run',
      'test:component:coverage',
    ]),
    step(1, 'fold-web-component', 'gate', 'pnpm', [
      '--filter',
      '@qaroom/web',
      'run',
      'test:component:results',
    ]),
    // Web node unit coverage (api/client, http, lib, session/jwt, flow machines) → coverage:web-node.
    step(1, 'web-node-coverage', 'gate', 'pnpm', [
      '--filter',
      '@qaroom/web',
      'run',
      'test:coverage',
    ]),
    // Backend v8 coverage (content + donations on defineServiceConfig) must run before fold-coverage,
    // or coverage:results finds no per-service coverage-summary.json and folds only web.
    step(1, 'backend-coverage', 'gate', 'pnpm', [
      '--filter',
      '@qaroom/content',
      '--filter',
      '@qaroom/donations',
      '--filter',
      '@qaroom/flags',
      '--filter',
      '@qaroom/gateway',
      '--filter',
      '@qaroom/identity',
      'run',
      'test:coverage',
    ]),
    step(1, 'fold-coverage', 'gate', 'pnpm', ['coverage:results']),
    step(1, 'verify-envelope', 'gate', 'pnpm', ['test-results:verify']),
  ]

  // Sanctioned concurrency: Stryker is CPU-bound mutation sandboxing, the LLM lane is
  // network-bound OpenAI round-trips — neither measures local wall-clock, so they share the slot.
  const noKey = ctx.hasOpenAIKey ? undefined : 'OPENAI_API_KEY not set'
  const noUv = ctx.hasUv ? undefined : 'uv not installed'
  const llmSkip = noKey ?? noUv
  const phase2: GauntletStep[] = [
    step(2, 'stryker-critical', 'gate', 'pnpm', ['stryker:critical'], {
      lane: 'mutation',
      timeoutMs: 60 * 60_000,
    }),
    step(2, 'fold-stryker', 'gate', 'pnpm', ['stryker:results'], { lane: 'mutation' }),
    step(
      2,
      'eval-cost-guard',
      'gate',
      'uv',
      ['run', 'python', '-m', 'moderator_agent.eval_cost_guard'],
      {
        lane: 'llm',
        cwd: MOD,
        skipReason: llmSkip,
      },
    ),
    step(2, 'evals-llm-golden-metamorphic', 'gate', 'uv', ['run', 'pytest', '-q', '-m', 'llm'], {
      lane: 'llm',
      cwd: MOD,
      skipReason: llmSkip,
    }),
    step(2, 'fold-golden', 'gate', 'pnpm', ['golden:results'], {
      lane: 'llm',
      skipReason: llmSkip,
    }),
    step(
      2,
      'evals-deepeval',
      'gate',
      'pnpm',
      ['--filter', '@qaroom/moderator-agent', 'run', 'eval:deepeval'],
      {
        lane: 'llm',
        skipReason: llmSkip,
      },
    ),
    step(2, 'fold-deepeval', 'gate', 'pnpm', ['deepeval:results'], {
      lane: 'llm',
      skipReason: llmSkip,
    }),
    step(
      2,
      'evals-deepteam',
      'gate',
      'pnpm',
      ['--filter', '@qaroom/moderator-agent', 'run', 'eval:deepteam'],
      {
        lane: 'llm',
        skipReason: llmSkip,
      },
    ),
    step(2, 'fold-deepteam', 'gate', 'pnpm', ['deepteam:results'], {
      lane: 'llm',
      skipReason: llmSkip,
    }),
    step(
      2,
      'evals-pyrit',
      'gate',
      'pnpm',
      ['--filter', '@qaroom/moderator-agent', 'run', 'eval:pyrit'],
      {
        lane: 'llm',
        timeoutMs: 60 * 60_000,
        skipReason:
          llmSkip ?? (opts.pyrit ? undefined : 'pyrit is opt-in (--pyrit) — longest, most spend'),
      },
    ),
    step(2, 'fold-pyrit', 'gate', 'pnpm', ['pyrit:results'], {
      lane: 'llm',
      skipReason: llmSkip ?? (opts.pyrit ? undefined : 'pyrit is opt-in (--pyrit)'),
    }),
  ]

  const noTracetest = ctx.hasTracetest ? undefined : 'tracetest CLI not installed'
  const noCluster = ctx.hasK3d && ctx.hasTilt ? undefined : 'k3d/tilt not installed'

  const phase3: GauntletStep[] = [
    step(3, 'cluster-bootstrap', 'infra', 'bash', ['scripts/bootstrap-k3d.sh'], {
      timeoutMs: 15 * 60_000,
      skipReason:
        noCluster ??
        (opts.reuseCluster ? 'reusing the existing cluster (--reuse-cluster)' : undefined),
    }),
    step(3, 'tilt-ci', 'infra', 'tilt', ['ci'], { timeoutMs: 25 * 60_000, skipReason: noCluster }),
    step(3, 'chaos-install', 'infra', 'pnpm', ['chaos:install'], {
      timeoutMs: 10 * 60_000,
      skipReason: noCluster,
    }),
    step(3, 'chaos-smoke', 'gate', 'pnpm', ['chaos:smoke'], { skipReason: noCluster }),
    step(3, 'cluster-smoke', 'gate', 'pnpm', ['smoke'], { skipReason: noCluster }),
    // Model-based E2E through the INGRESS, not a port-forward: the rollout spec creates its
    // community from the browser via a same-origin `/api` fetch, which only routes to the gateway
    // under qaroom.localhost (Chromium resolves *.localhost; Traefik routes /api + /ws to the
    // gateway there). A port-forward to svc/web would serve the SPA but not proxy /api — the spec
    // would fail. The k3d cluster maps host ports 80/443, so the ingress needs no PF wrapper.
    step(3, 'web-e2e', 'gate', 'pnpm', ['--filter', '@qaroom/web', 'run', 'e2e'], {
      env: { WEB_BASE_URL: 'http://qaroom.localhost' },
      timeoutMs: 20 * 60_000,
      skipReason: noCluster,
    }),
    // Folds a `web-e2e` runner into summary.json from test-results/e2e.json (the `e2e:results`
    // script is owned by the e2e-fold session; it will exist by merge).
    step(3, 'web-e2e-fold', 'gate', 'pnpm', ['--filter', '@qaroom/web', 'run', 'e2e:results'], {
      skipReason: noCluster,
    }),
  ]

  const phase4: GauntletStep[] = [
    // Needs OPENAI_API_KEY on the in-cluster moderator; degrades to a Failed decision — observe.
    step(4, 'seed-moderation', 'observe', 'bash', ['scripts/seed-moderation.sh'], {
      skipReason: noCluster,
    }),
    // HARD ordering constraint: the pristine bundle must exist before ANY fuzz/chaos pollution.
    sh(
      4,
      'replay-capture-baseline',
      'gate',
      `${PF} ${SNAPSHOT_FORWARDS} -- pnpm replay:capture gauntlet-baseline`,
      { skipReason: noCluster },
    ),
    // The golden journey walks every service THROUGH the gateway on the clean post-baseline
    // cluster, then asserts Commitment 9 (tenant.id, against live Jaeger) + RFC 7807 on the traffic
    // it produced. Gated on the OPENAI key in addition to the cluster: the main walk's
    // moderation-decision assertion is UNCONDITIONAL and the keyless in-cluster moderator records no
    // decision, so the whole walk reds without a key — there is no self-skipping moderation leg.
    step(4, 'journey-run', 'gate', 'pnpm', ['journey:run'], {
      timeoutMs: 15 * 60_000,
      skipReason: noCluster ?? noKey,
    }),
    // Folds a `journey` runner into test-results/summary.json (mirrors the run step's gate).
    step(4, 'journey-results', 'gate', 'pnpm', ['journey:results'], {
      skipReason: noCluster ?? noKey,
    }),
    step(4, 'rollout-tour', 'gate', 'bash', ['scripts/live-rollout-tour.sh'], {
      skipReason: noCluster,
    }),
    step(4, 'race-probe', 'gate', 'bash', ['scripts/live-rollout-race-probe.sh'], {
      skipReason: noCluster,
    }),
    // The rollout-transition def sends EnableRequested (legal only from Off); reset first so the
    // suite is idempotent across reruns — without this, repeated runs park the machine where the
    // def's event 409s and it fails on MISSING spans (gauntlet finding, 2026-06-10).
    sh(
      4,
      'rollout-reset',
      'gate',
      `${PF} flags:18083:80 -- bash scripts/reset-rollout.sh http://localhost:18083`,
      { skipReason: noCluster },
    ),
    sh(4, 'tracetest-suite', 'gate', `${PF} ${TRACETEST_FWD} -- pnpm tracetest:results`, {
      env: TRACETEST_ENV,
      timeoutMs: 20 * 60_000,
      skipReason: noCluster ?? noTracetest,
    }),
    sh(4, 'tenant-spans-baseline', 'gate', `${PF} ${JAEGER_FWD} -- pnpm check:tenant-spans`, {
      env: JAEGER_ENV,
      skipReason: noCluster,
    }),
  ]

  const phase5: GauntletStep[] = [
    sh(
      5,
      'k6-thresholds-drift',
      'gate',
      'pnpm k6:gen && git diff --exit-code load-tests/lib/slo-thresholds.gen.json',
      { skipReason: noCluster },
    ),
    sh(
      5,
      'k6-vote-cast',
      'gate',
      `${PF} content:18081:80 -- ${K6_DOCKER} load-tests/vote-cast.js -e CONTENT_BASE_URL=http://host.docker.internal:18081 -e K6_SLO_MULTIPLIER=3`,
      { timeoutMs: 20 * 60_000, skipReason: noCluster },
    ),
    sh(
      5,
      'k6-feed',
      'gate',
      `${PF} content:18081:80 -- ${K6_DOCKER} load-tests/feed.js -e CONTENT_BASE_URL=http://host.docker.internal:18081 -e K6_SLO_MULTIPLIER=3`,
      { timeoutMs: 20 * 60_000, skipReason: noCluster },
    ),
    step(5, 'k6-fold-clean', 'gate', 'pnpm', ['k6:results'], { skipReason: noCluster }),
    // Known issue (2026-06-08): the Microcks payment mock 404s POST /charges → donations 502s.
    // Run it anyway and keep the artifact OUT of the k6-*.json fold glob — honest evidence shows
    // the broken thing red with a pointer instead of hiding it.
    sh(
      5,
      'k6-donation-known-issue',
      'observe',
      `${PF} donations:18084:80 -- ${K6_DOCKER} load-tests/donation.js -e DONATIONS_BASE_URL=http://host.docker.internal:18084 -e K6_SLO_MULTIPLIER=3; mv test-results/k6-donation.json test-results/known-issue-k6-donation.json 2>/dev/null || true`,
      { timeoutMs: 20 * 60_000, skipReason: noCluster },
    ),
  ]

  const phase6: GauntletStep[] = [
    // Live-upstream gateway fuzzing: the CI fuzz job proxies to ONE service (content); here every
    // upstream is real, so documented-502 theater on the other resource families disappears.
    sh(
      6,
      'schemathesis-live',
      'gate',
      `${PF} gateway:18090:80,identity:18082:80,webhooks:18087:80 -- pnpm schemathesis:results gateway:services/gateway:http://host.docker.internal:18090 identity:services/identity:http://host.docker.internal:18082 webhooks:services/webhooks:http://host.docker.internal:18087`,
      {
        // Paced under the gateway limiter's 10/s refill — at full speed the fuzzer drains the
        // bucket and the conformance checks misread its own 429s as contract violations.
        env: { SCHEMATHESIS_MAX_EXAMPLES: '50', SCHEMATHESIS_RATE_LIMIT: '8/s' },
        timeoutMs: 40 * 60_000,
        skipReason: noCluster,
      },
    ),
    sh(6, 'evomaster', 'gate', `${PF} content:18081:80 -- pnpm evomaster`, {
      env: { CONTENT_BASE_URL: 'http://localhost:18081' },
      timeoutMs: 30 * 60_000,
      skipReason: noCluster ?? (ctx.hasJava ? undefined : 'java 17+ not installed'),
    }),
    step(6, 'evomaster-fold', 'gate', 'pnpm', ['evomaster:results'], {
      skipReason: noCluster ?? (ctx.hasJava ? undefined : 'java 17+ not installed'),
    }),
    // Composition #1: do fuzzer-shaped requests still produce tenant.id-carrying spans?
    sh(6, 'tenant-spans-post-fuzz', 'observe', `${PF} ${JAEGER_FWD} -- pnpm check:tenant-spans`, {
      env: JAEGER_ENV,
      skipReason: noCluster,
    }),
  ]

  const phase7: GauntletStep[] = [
    step(7, 'chaos-run', 'gate', 'pnpm', ['chaos:run'], {
      timeoutMs: 45 * 60_000,
      skipReason: noCluster,
    }),
    step(7, 'chaos-fold', 'gate', 'pnpm', ['chaos:results'], { skipReason: noCluster }),
    // Composition #2: SLO degradation magnitude under an active fault (measure-only by default).
    step(
      7,
      'k6-under-chaos-02-vote',
      'observe',
      'bash',
      ['scripts/k6-under-chaos.sh', '02-net-slow-nats', 'vote-cast'],
      { timeoutMs: 20 * 60_000, skipReason: noCluster },
    ),
    step(
      7,
      'k6-under-chaos-04-donation',
      'observe',
      'bash',
      ['scripts/k6-under-chaos.sh', '04-stress-pg-pool-exhaustion', 'donation'],
      { timeoutMs: 20 * 60_000, skipReason: noCluster },
    ),
    // Composition #3: are trace-based assertions robust or flaky under induced latency?
    sh(
      7,
      'tracetest-under-chaos',
      'observe',
      `bash scripts/with-chaos.sh 02-net-slow-nats -- ${PF} ${TRACETEST_FWD} -- pnpm tracetest:results services/content/tests/tracetest/post-created-publish.yaml services/content/tests/tracetest/feed-read.yaml`,
      { env: TRACETEST_ENV, timeoutMs: 20 * 60_000, skipReason: noCluster ?? noTracetest },
    ),
    step(7, 'k6-fold-chaos', 'observe', 'pnpm', ['k6:results'], { skipReason: noCluster }),
  ]

  const phase8: GauntletStep[] = [
    // Composition #4: quantified state pollution — diff this bundle against the baseline.
    sh(
      8,
      'replay-capture-aftermath',
      'gate',
      `${PF} ${SNAPSHOT_FORWARDS} -- pnpm replay:capture gauntlet-aftermath`,
      { skipReason: noCluster },
    ),
    step(8, 'replay-regression', 'gate', 'pnpm', ['replay:regression'], {
      timeoutMs: 20 * 60_000,
    }),
    sh(
      8,
      'rollout-reset-recovery',
      'gate',
      `${PF} flags:18083:80 -- bash scripts/reset-rollout.sh http://localhost:18083`,
      { skipReason: noCluster },
    ),
    sh(8, 'tracetest-recovery', 'gate', `${PF} ${TRACETEST_FWD} -- pnpm tracetest:results`, {
      env: TRACETEST_ENV,
      timeoutMs: 20 * 60_000,
      skipReason: noCluster ?? noTracetest,
    }),
    sh(8, 'tenant-spans-final', 'gate', `${PF} ${JAEGER_FWD} -- pnpm check:tenant-spans --fold`, {
      env: { ...JAEGER_ENV, TENANT_SPAN_LOOKBACK: '6h', TENANT_SPAN_LIMIT: '200' },
      skipReason: noCluster,
    }),
    // Composition #5 (opt-in): one live toggle vs a live technique — prove --break at gauntlet scale.
    sh(
      8,
      'triangulate-feed-reversed',
      'observe',
      `bash scripts/live-toggle.sh content CONTENT_BUG_FEED_REVERSED=1 -- ${PF} ${TRACETEST_FWD} -- pnpm tracetest:results services/content/tests/tracetest/feed-read.yaml`,
      {
        env: TRACETEST_ENV,
        timeoutMs: 15 * 60_000,
        skipReason:
          noCluster ?? noTracetest ?? (opts.triangulate ? undefined : 'opt-in (--triangulate)'),
      },
    ),
    step(8, 'verify-envelope-final', 'gate', 'pnpm', ['test-results:verify']),
    step(8, 'claims-verify', 'gate', 'pnpm', ['claims:verify'], {
      timeoutMs: 20 * 60_000,
      // The gauntlet brings the cluster up and primes it, so this is where live-tier claim teeth
      // (tenant-span, outbox-latency) can actually arm the bug in-pod — opt in to running them.
      env: { LIVE_TEETH: '1' },
    }),
  ]

  const phase9: GauntletStep[] = [
    step(9, 'gauntlet-report', 'gate', 'pnpm', ['gauntlet:report']),
    sh(9, 'teardown', 'infra', 'tilt down; bash scripts/teardown-k3d.sh', {
      skipReason: opts.down ? noCluster : 'cluster stays up for poking (--down to tear down)',
    }),
  ]

  return [
    ...phase1,
    ...phase2,
    ...phase3,
    ...phase4,
    ...phase5,
    ...phase6,
    ...phase7,
    ...phase8,
    ...phase9,
  ]
}

/** A step whose command needs shell features (pipes, &&, $PWD, post-mv) — bash -c wrapped. */
function sh(
  phase: number,
  name: string,
  cls: GauntletStep['class'],
  command: string,
  extra: Partial<GauntletStep> = {},
): GauntletStep {
  return step(phase, name, cls, 'bash', ['-c', command], extra)
}

function step(
  phase: number,
  name: string,
  cls: GauntletStep['class'],
  cmd: string,
  args: string[],
  extra: Partial<GauntletStep> = {},
): GauntletStep {
  return {
    phase,
    phaseTitle: PHASE_TITLES[phase] ?? `Phase ${phase}`,
    name,
    class: cls,
    cmd,
    args,
    ...extra,
  }
}
