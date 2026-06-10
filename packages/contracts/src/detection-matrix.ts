import { z } from 'zod'
import { MatrixTier } from './detection-matrix-schema'

/**
 * The detection-matrix toggle manifest — every deliberate-bug env toggle in the repo, with where
 * it is read, how it is armed, and what was DESIGNATED to catch it. The matrix experiment
 * (scripts/detection-matrix.ts) generalizes `pnpm prove <id> --break` from one designated gate to
 * the whole battery: arm each toggle, run everything, record every technique's verdict. Sibling
 * of claims.ts — claims are the permanent gates; this manifest is the experiment's ground truth.
 *
 * The census rule: a toggle may only be listed if non-test code actually reads its env var
 * (`pnpm matrix --verify` greps each readSite, mirroring claims-verify's checkWired) — the
 * manifest can never name a toggle nothing reads.
 */
export const ToggleTiming = z.enum([
  /** Read on every call — external env injection is honored mid-process. */
  'call-time',
  /** Read once when the server/object is built — tests reusing a prebuilt fixture miss it. */
  'construction-time',
  /** Read when pydantic Settings() loads — Python; per-test settings fixtures honor it. */
  'settings-load',
])
export type ToggleTiming = z.infer<typeof ToggleTiming>

export const DetectionToggle = z.object({
  id: z.string(),
  env: z.object({ name: z.string(), value: z.string() }),
  component: z.string(),
  readSite: z.object({ file: z.string(), timing: ToggleTiming }),
  /** What the repo SAYS catches this (null = nothing references the env; purely empirical). */
  designatedCatcher: z.string().nullable(),
  /** Cross-ref into claims.ts when this toggle already backs a permanent claim. */
  claimId: z.string().optional(),
  tiers: z.array(MatrixTier).min(1),
  /** Test files that arm/clear this env THEMSELVES (vitest file isolation contains it, but
   *  their verdicts under external injection invert — annotate, never naively count). */
  selfToggling: z.array(z.string()),
  notes: z.string().optional(),
})
export type DetectionToggle = z.infer<typeof DetectionToggle>

export const TOGGLES: DetectionToggle[] = z.array(DetectionToggle).parse([
  // ── messaging / otel (shared infrastructure — expect wide blast radius, H6) ──
  {
    id: 'skip-dedup',
    env: { name: 'CHAOS_SKIP_DEDUP', value: '1' },
    component: 'messaging',
    readSite: { file: 'packages/messaging/src/subscribe.ts', timing: 'call-time' },
    designatedCatcher: null,
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'No test file references the env — consumers exercising processEvent through the real ' +
      'subscribe path hit it; the catcher set is purely empirical.',
  },
  {
    id: 'tenant-span-drop',
    env: { name: 'CHAOS_TENANT_SPAN_DROP', value: '1' },
    component: 'otel',
    readSite: { file: 'packages/otel/src/tenant-span-processor.ts', timing: 'call-time' },
    designatedCatcher: 'scripts/check-tenant-spans.ts (live Jaeger audit)',
    tiers: ['in-proc', 'cluster'],
    selfToggling: ['packages/otel/src/tenant-span-processor.test.ts'],
    notes: 'Candidate permanent claim: tenant-span-everywhere (Commitment 9, live tier).',
  },
  // ── content ──
  {
    id: 'feed-reversed',
    env: { name: 'CONTENT_BUG_FEED_REVERSED', value: '1' },
    component: 'content',
    readSite: { file: 'services/content/src/repository.ts', timing: 'call-time' },
    designatedCatcher: null,
    tiers: ['in-proc', 'cluster'],
    selfToggling: ['services/content/tests/snapshot-replay.verify.ts'],
    notes:
      'The replay regression verifier arms AND clears this env itself; feed-order assertions in ' +
      'the content suite are the expected empirical catchers.',
  },
  {
    id: 'vote-slow',
    env: { name: 'CONTENT_BUG_VOTE_SLOW_MS', value: '800' },
    component: 'content',
    readSite: { file: 'services/content/src/repository.ts', timing: 'call-time' },
    designatedCatcher: 'load-tests/vote-cast.js (k6 SLO gate, exit 99)',
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'H3 probe: predicted MISSED by every functional technique in-proc (suites get slower, not ' +
      'redder) and caught only by the k6 SLO threshold — performance bugs need a performance gate.',
  },
  {
    id: 'sync-publish',
    env: { name: 'CHAOS_SYNC_PUBLISH', value: '1' },
    component: 'content',
    readSite: { file: 'services/content/src/server.ts', timing: 'construction-time' },
    designatedCatcher: 'scripts/k6-under-chaos.sh 02-net-slow-nats vote-cast (chaos × load)',
    tiers: ['cluster'],
    selfToggling: [],
    notes:
      'The composition-only bug (failure-modes.md#02, demo previously documented-unbuilt): lives ' +
      'in live-only wiring, a no-op burden on a healthy broker — green in-proc, green under chaos ' +
      'alone, green under load alone; red ONLY under chaos+load. Candidate permanent claim: ' +
      'outbox-isolates-broker-latency.',
  },
  // ── flags ──
  {
    id: 'canary-misroutes',
    env: { name: 'FLAGS_BUG_CANARY_MISROUTES', value: '1' },
    component: 'flags',
    readSite: { file: 'services/flags/src/repository.ts', timing: 'call-time' },
    designatedCatcher: null,
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'Guarded by NODE_ENV !== "production" — a cluster row only works if the deployed pod is not ' +
      'NODE_ENV=production; check the image env before counting a miss.',
  },
  // ── gateway ──
  {
    id: 'disable-circuit-breaker',
    env: { name: 'CHAOS_DISABLE_CIRCUIT_BREAKER', value: '1' },
    component: 'gateway',
    readSite: { file: 'services/gateway/src/server.ts', timing: 'construction-time' },
    designatedCatcher: 'services/gateway/tests/circuit-breaker.spec.ts',
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'Construction-time read: only tests that BUILD a server under the injected env see it; a ' +
      'suite reusing one prebuilt fixture would not — exactly what the matrix measures.',
  },
  {
    id: 'upstream-timeout',
    env: { name: 'GATEWAY_UPSTREAM_TIMEOUT_MS', value: '600000' },
    component: 'gateway',
    readSite: { file: 'services/gateway/src/upstream-call.ts', timing: 'call-time' },
    designatedCatcher: 'tests/chaos/07-net-partition-gateway-donations.test.ts (live partition)',
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'A far-too-high timeout only bites when an upstream actually hangs — predicted in-proc ' +
      'all-miss; the chaos partition experiment is what exposes it.',
  },
  // ── webhooks (Milestone 11 — each property file self-arms its demo describe) ──
  {
    id: 'webhook-sign-body-only',
    env: { name: 'CHAOS_WEBHOOK_SIGN_BODY_ONLY', value: '1' },
    component: 'webhooks',
    readSite: { file: 'services/webhooks/src/worker.ts', timing: 'call-time' },
    designatedCatcher: 'services/webhooks/src/signing.property.test.ts',
    claimId: 'webhook-signing',
    tiers: ['in-proc'],
    selfToggling: ['services/webhooks/src/signing.property.test.ts'],
  },
  {
    id: 'webhook-unstable-delivery-id',
    env: { name: 'CHAOS_WEBHOOK_UNSTABLE_DELIVERY_ID', value: '1' },
    component: 'webhooks',
    readSite: { file: 'services/webhooks/src/worker.ts', timing: 'call-time' },
    designatedCatcher: 'services/webhooks/src/redelivery-dedup.property.test.ts',
    tiers: ['in-proc'],
    selfToggling: ['services/webhooks/src/redelivery-dedup.property.test.ts'],
  },
  {
    id: 'webhook-drop-on-fail',
    env: { name: 'CHAOS_WEBHOOK_DROP_ON_FAIL', value: '1' },
    component: 'webhooks',
    readSite: { file: 'services/webhooks/src/worker.ts', timing: 'call-time' },
    designatedCatcher: 'services/webhooks/src/delivery-guarantee.property.test.ts',
    claimId: 'webhook-at-least-once',
    tiers: ['in-proc'],
    selfToggling: ['services/webhooks/src/delivery-guarantee.property.test.ts'],
  },
  {
    id: 'webhook-no-cap',
    env: { name: 'CHAOS_WEBHOOK_NO_CAP', value: '1' },
    component: 'webhooks',
    readSite: { file: 'services/webhooks/src/worker.ts', timing: 'call-time' },
    designatedCatcher: 'services/webhooks/src/retry-schedule.property.test.ts',
    tiers: ['in-proc'],
    selfToggling: ['services/webhooks/src/retry-schedule.property.test.ts'],
  },
  {
    id: 'webhook-illegal-transition',
    env: { name: 'CHAOS_WEBHOOK_ILLEGAL_TRANSITION', value: '1' },
    component: 'webhooks',
    readSite: { file: 'services/webhooks/src/worker.ts', timing: 'call-time' },
    designatedCatcher: 'services/webhooks/tests/reverse-conformance.spec.ts',
    tiers: ['in-proc', 'cluster'],
    selfToggling: ['services/webhooks/tests/reverse-conformance.spec.ts'],
    notes:
      'H7 probe: the cluster tier (Tracetest span-edge assertion) vs the in-proc ' +
      'reverse-conformance spec — does live detection ADD anything beyond environmental realism?',
  },
  // ── moderator-agent (Python; env → pydantic Settings at load) ──
  {
    id: 'moderator-disable-input-guard',
    env: { name: 'MODERATOR_DISABLE_INPUT_GUARD', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    designatedCatcher: 'services/moderator-agent/evals/redteam/test_deepteam_owasp.py',
    tiers: ['in-proc', 'llm'],
    selfToggling: [],
  },
  {
    id: 'moderator-prompt-bug',
    env: { name: 'MODERATOR_PROMPT_BUG', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    designatedCatcher: 'services/moderator-agent/tests/test_metamorphic.py (llm-marked)',
    tiers: ['in-proc', 'llm'],
    selfToggling: [],
    notes:
      'The metamorphic catcher needs OPENAI_API_KEY — the in-proc row shows what keyless CI sees.',
  },
  {
    id: 'moderator-ungrounded',
    env: { name: 'MODERATOR_UNGROUNDED', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    designatedCatcher: 'services/moderator-agent/evals/deepeval/test_rag_metrics.py (faithfulness)',
    tiers: ['in-proc', 'llm'],
    selfToggling: [],
  },
  {
    id: 'moderator-disable-abstain',
    env: { name: 'MODERATOR_DISABLE_ABSTAIN', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    designatedCatcher: 'services/moderator-agent/tests/test_selfcheck.py',
    claimId: 'moderator-abstain',
    tiers: ['in-proc', 'llm'],
    selfToggling: [],
  },
  {
    id: 'moderator-rerank-bug',
    env: { name: 'MODERATOR_RERANK_BUG', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    designatedCatcher: 'services/moderator-agent/tests/test_reranker.py',
    tiers: ['in-proc', 'llm'],
    selfToggling: [],
    notes:
      'H1 probe: predicted single-point-of-detection (delete test_reranker.py and this ships).',
  },
])

export const toggleById = (id: string): DetectionToggle | undefined =>
  TOGGLES.find((t) => t.id === id)

/**
 * Technique-group classification by file path — ORDER MATTERS (first match wins). One vitest
 * sweep fills many matrix columns by classifying its failing files; same for pytest.
 */
export const TS_TECHNIQUE_CLASSIFIERS: readonly (readonly [RegExp, string])[] = [
  [/\.property\.test\.ts$/, 'property'],
  [/(\.mbt\.spec\.ts|stateful\.pbt\.spec\.ts)$/, 'mbt'],
  [/reverse-conformance/, 'reverse-conformance'],
  [/crosscheck/, 'pact-oas-crosscheck'],
  [/tests\/contracts\//, 'pact'],
  [/\.spec\.ts$/, 'integration'],
  [/\.test\.ts$/, 'unit'],
]

export const PY_TECHNIQUE_CLASSIFIERS: readonly (readonly [RegExp, string])[] = [
  [/test_metamorphic/, 'metamorphic'],
  [/test_(workflow|drift|schemas_crosslang|subjects_crosslang)/, 'py-conformance'],
  [/evals\/deepeval\//, 'deepeval'],
  [/evals\/redteam\//, 'redteam'],
  [/test_/, 'py-unit'],
]

export const classifyTechnique = (
  file: string,
  classifiers: readonly (readonly [RegExp, string])[],
): string => classifiers.find(([re]) => re.test(file))?.[1] ?? 'other'
