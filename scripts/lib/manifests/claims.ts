import { z } from 'zod'

/**
 * The falsifiable-claim manifest — the ONE new source of truth for QARoom's demoability (see
 * docs/adr when committed). Every audience surface (the `pnpm prove` CLI, the skimmer matrix, the
 * README badge) is a drift-gated PROJECTION of this array — the repo's own
 * one-source→many-projections pattern, dogfooded onto its own story.
 *
 * The atom is a FALSIFIABLE CLAIM in one grammar:
 *   "<claim>. Breaks when <toggle>. Caught by <gate>. Evidence: <live value from summary.json>."
 *
 * The `toggle` is the bridge between audiences: a skimmer READS "breaks when CHAOS_WEBHOOK_…", a
 * runner EXECUTES `pnpm prove <id> --break` (which sets that exact env var and re-runs the gate). A
 * claim is only honest if its gate goes RED when the toggle is set — `pnpm claims:verify` proves
 * that empirically, so the manifest can never decay into theater.
 */

/** The nine architectural boundaries (docs/02). A claim defends exactly one. */
export const BOUNDARIES = [
  'trust',
  'process-rest',
  'process-async',
  'tenancy',
  'temporal',
  'external-dep',
  'observability',
  'websocket',
  'identity-issuance',
  'meta',
] as const

/** A runnable gate — the guarantee test that goes RED when the claim's toggle is set. */
export const Gate = z.object({
  cmd: z.string(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
})
export type Gate = z.infer<typeof Gate>

/** A live-evidence selector into the frozen test-results/summary.json. Never a hand-typed number. */
export const Evidence = z.object({
  runner: z.string(),
  field: z.enum(['passed', 'failed', 'skipped']),
})
export type Evidence = z.infer<typeof Evidence>

export const Claim = z
  .object({
    /** kebab-case id, the `pnpm prove <id>` handle. */
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** The one-sentence assertion. */
    claim: z.string().min(1),
    boundary: z.enum(BOUNDARIES),
    /**
     * The boundary-registry row this claim belongs to on documentation surfaces. `boundary` is the
     * gate LANE (the enum above); this is the reader-facing taxonomy (one vocabulary everywhere:
     * the 2026-06-11 critique caught webhook-signing labelled `trust` while the breadth table put
     * HMAC at the delivery edge). Validated against boundary-registry.ts by `claims:verify`
     * (a direct schema import would be a cycle: the registry imports BOUNDARIES from this file).
     */
    registryRow: z.string().regex(/^[a-z0-9-]+$/),
    technique: z.string().min(1),
    /** EXACT deliberate-bug env var. `claims:verify` confirms a real service reads it. */
    toggle: z.string().regex(/^[A-Z0-9_]+$/),
    /** The guarantee test that holds without the toggle and breaks with it. */
    gate: Gate,
    /** Live evidence pointer into summary.json. */
    evidence: Evidence,
    /** Lowest tier that can prove it: offline (read summary) | simulate (in-process) | live (cluster). */
    tier: z.enum(['offline', 'simulate', 'live']),
  })
  .strict()
export type Claim = z.infer<typeof Claim>

// Phase-1 flagship claims. Each verified to genuinely falsify via env toggle (the guarantee test
// reads the toggle from env, so setting it turns that exact test RED). Distinct boundaries, two
// services, two languages — proving the mechanic generalizes before scaling to one-per-boundary.
const RAW: Claim[] = [
  {
    id: 'webhook-signing',
    claim:
      'A webhook signature binds the timestamp, so a captured (body, signature) pair cannot be replayed.',
    boundary: 'trust',
    registryRow: 'delivery-edge',
    technique: 'property test (HMAC-SHA256, timestamp-bound)',
    toggle: 'CHAOS_WEBHOOK_SIGN_BODY_ONLY',
    gate: {
      cmd: 'pnpm',
      args: [
        '--filter',
        '@qaroom/webhooks',
        'exec',
        'vitest',
        'run',
        '-t',
        'binds the timestamp into the signature',
      ],
    },
    evidence: { runner: '@qaroom/webhooks', field: 'passed' },
    tier: 'simulate',
  },
  {
    id: 'webhook-at-least-once',
    claim:
      'Every webhook delivery reaches a terminal state; a failed send is retried, never silently dropped.',
    boundary: 'process-async',
    registryRow: 'delivery-edge',
    technique: 'property test over generated receiver-failure sequences',
    toggle: 'CHAOS_WEBHOOK_DROP_ON_FAIL',
    gate: {
      cmd: 'pnpm',
      args: [
        '--filter',
        '@qaroom/webhooks',
        'exec',
        'vitest',
        'run',
        '-t',
        'every delivery reaches a terminal state',
      ],
    },
    evidence: { runner: '@qaroom/webhooks', field: 'passed' },
    tier: 'simulate',
  },
  {
    id: 'moderator-abstain',
    claim:
      'The moderator escalates to a human on a low-confidence verdict instead of guessing (FR5 calibration).',
    boundary: 'external-dep',
    registryRow: 'external-dep',
    technique: 'deterministic workflow test (no LLM, no cluster)',
    toggle: 'MODERATOR_DISABLE_ABSTAIN',
    gate: {
      cmd: 'uv',
      args: [
        'run',
        'pytest',
        '-q',
        'tests/test_workflow_decision.py',
        '-k',
        'low_confidence_draft_escalates',
      ],
      cwd: 'services/moderator-agent',
    },
    evidence: { runner: 'moderator', field: 'passed' },
    tier: 'simulate',
  },
  {
    id: 'moderator-no-confident-approve-of-flag',
    claim:
      'The moderator never confidently approves content the precedent flags: an approve that diverges from majority-remove precedent escalates to a human instead. The safety invariant, not gold-set agreement, is the bar — which is what lets the cheaper gpt-5-nano draft model stay safe (a confident-but-wrong approve is caught structurally, not shipped).',
    boundary: 'external-dep',
    registryRow: 'external-dep',
    technique: 'deterministic self-check test (no LLM, no cluster)',
    toggle: 'MODERATOR_DISABLE_APPROVE_GUARD',
    gate: {
      cmd: 'uv',
      args: ['run', 'pytest', '-q', 'tests/test_selfcheck.py', '-k', 'safety_invariant_escalates'],
      cwd: 'services/moderator-agent',
    },
    evidence: { runner: 'moderator', field: 'passed' },
    tier: 'simulate',
  },
  {
    // Added 2026-06-10 after detection-matrix Tier C found the BEHAVIOURAL injection demo had rotted
    // (the pinned model resists the injection unguarded, so "the bug lands" no longer reproduces and a
    // green eval can't tell "caught" from "model outgrew it"). The honest, rot-proof teeth are the
    // guard MECHANISM: a pure string transform that fences attacker-controlled bodies as DATA. Only
    // deterministic gates earn `prove --break`; the live-model red-team stays a tracked METRIC, not a
    // claim (evals/README.md).
    id: 'input-guard-fences-untrusted-body',
    claim:
      'The moderator fences attacker-controlled post bodies as DATA before they reach the model; disabling the guard leaves them in instruction context.',
    boundary: 'external-dep',
    registryRow: 'external-dep',
    technique: 'deterministic guard unit test (keyless, no model — cannot rot)',
    toggle: 'MODERATOR_DISABLE_INPUT_GUARD',
    gate: {
      cmd: 'uv',
      args: [
        'run',
        'pytest',
        '-q',
        'tests/test_guard.py',
        '-k',
        'env_armed_disable_toggle_unfences',
      ],
      cwd: 'services/moderator-agent',
    },
    evidence: { runner: 'moderator', field: 'passed' },
    tier: 'simulate',
  },
  {
    // The INDIRECT-injection sibling of input-guard (2026-06-15). The post-body guard fences the
    // DIRECT channel; this fences the RETRIEVED one. Precedents derive from past post bodies, so the
    // RAG corpus is attacker-REACHABLE: a poisoned precedent is a STORED injection (OWASP LLM01
    // indirect / ASI01 goal-hijacking) that lands in the trusted half of the prompt, downstream of the
    // body guard. Same rot-proof discipline: a keyless string-transform gate, not a model-dependent
    // behavioural demo (the live-model payoff is the key-gated ASI-2026 red-team METRIC).
    id: 'retrieved-context-fenced',
    claim:
      'The moderator fences attacker-reachable retrieved context (poisoned precedents / policy text) as DATA before it reaches the model; disabling the corpus guard leaves a stored injection in instruction context.',
    boundary: 'external-dep',
    registryRow: 'external-dep',
    technique: 'deterministic corpus-guard unit test (keyless, no model — cannot rot)',
    toggle: 'MODERATOR_DISABLE_CORPUS_GUARD',
    gate: {
      cmd: 'uv',
      args: [
        'run',
        'pytest',
        '-q',
        'tests/test_corpus_guard.py',
        '-k',
        'env_armed_corpus_disable_toggle_unfences',
      ],
      cwd: 'services/moderator-agent',
    },
    evidence: { runner: 'moderator', field: 'passed' },
    tier: 'simulate',
  },
  {
    // Phase-1 of the verifiable-invariants experiment (experiment/verifiable-invariants, ADR-0024):
    // the ±1 rule is defined ONCE (contracts' VOTE_VALUES) and DERIVED into the Zod boundary schema,
    // the DB CHECK (votes_value_check), the OpenAPI doc, and the fast-check arbitrary. The toggle
    // writes an out-of-range value; the DB CHECK rejects it and this property goes red.
    id: 'vote-value-in-band',
    claim:
      'A stored vote is exactly +1 or -1, so a post score can only ever equal (upvotes − downvotes); an out-of-range value can neither enter the votes table nor inflate the score. The ±1 rule lives in one place (VOTE_VALUES) and the request schema, DB CHECK, OpenAPI, and property generator all derive from it.',
    boundary: 'process-rest',
    registryRow: 'process-rest',
    technique: 'property test (Zod-derived ±1 arbitrary) over the real castVote + DB CHECK',
    toggle: 'CONTENT_BUG_VOTE_OUT_OF_RANGE',
    gate: {
      cmd: 'pnpm',
      args: [
        '--filter',
        '@qaroom/content',
        'exec',
        'vitest',
        'run',
        '-t',
        // vitest -t is a REGEX: the test name's literal `+`/`-` would be quantifiers, matching
        // zero tests (a false GREEN). Filter on a regex-safe substring of the same test name.
        'score reconciles to upvotes minus downvotes',
      ],
    },
    evidence: { runner: '@qaroom/content', field: 'passed' },
    tier: 'simulate',
  },
  {
    id: 'tenant-isolation',
    claim:
      "A community's feed contains exactly its own posts and never another tenant's, even under an arbitrary interleave of cross-community writes (Commitment 9).",
    boundary: 'tenancy',
    registryRow: 'tenancy',
    technique: 'property-based isolation test (three-tenant interleave)',
    toggle: 'CONTENT_BUG_TENANT_LEAK',
    gate: {
      cmd: 'pnpm',
      args: [
        '--filter',
        '@qaroom/content',
        'exec',
        'vitest',
        'run',
        '-t',
        'appear only in their own feed',
      ],
    },
    evidence: { runner: '@qaroom/content', field: 'passed' },
    tier: 'simulate',
  },
  // Claims 5-6 (max-out program, 2026-06-10): the first LIVE-tier claims, chosen FROM the
  // detection-matrix results — both bugs are invisible to every in-process technique, so their
  // gates run against the deployed cluster. `prove --break` sets the toggle on the gate process;
  // scripts/live-claim-gate.sh forwards it onto the deployment(s) with a guaranteed revert.
  {
    id: 'tenant-span-everywhere',
    claim:
      'Every span the deployed system emits carries tenant.id (Commitment 9); a dropped stamp is caught by the live Jaeger audit.',
    boundary: 'observability',
    registryRow: 'observability',
    technique: 'live trace audit (Jaeger query over every service)',
    toggle: 'CHAOS_TENANT_SPAN_DROP',
    gate: {
      cmd: 'bash',
      args: [
        'scripts/live-claim-gate.sh',
        'content,gateway,identity,flags,donations,webhooks',
        'CHAOS_TENANT_SPAN_DROP',
        '--',
        'bash',
        'scripts/with-port-forward.sh',
        'observability/qaroom-jaeger:16686:16686',
        '--',
        'env',
        'JAEGER_QUERY_URL=http://localhost:16686',
        'TENANT_SPAN_LOOKBACK=15m',
        'pnpm',
        'check:tenant-spans',
      ],
    },
    evidence: { runner: 'tenant-spans', field: 'passed' },
    tier: 'live',
  },
  {
    id: 'outbox-isolates-broker-latency',
    claim:
      'The transactional outbox keeps mutating HTTP latency independent of the broker: publishing on the request path breaches the vote SLO even on a healthy broker.',
    boundary: 'process-async',
    registryRow: 'process-async',
    technique: 'k6 latency SLO gate against the deployed content-service',
    toggle: 'CHAOS_SYNC_PUBLISH',
    gate: {
      cmd: 'bash',
      args: [
        'scripts/live-claim-gate.sh',
        'content',
        'CHAOS_SYNC_PUBLISH',
        '--',
        'bash',
        'scripts/with-port-forward.sh',
        'content:18081:80',
        '--',
        'bash',
        '-c',
        'docker run --rm -v "$PWD":/work -w /work grafana/k6 run load-tests/vote-cast.js -e CONTENT_BASE_URL=http://host.docker.internal:18081 -e K6_SLO_MULTIPLIER=3',
      ],
    },
    evidence: { runner: 'k6', field: 'passed' },
    tier: 'live',
  },
]

/** The validated manifest. Throws at import if any claim violates the schema. */
export const CLAIMS: readonly Claim[] = z.array(Claim).parse(RAW)

export function claimById(id: string): Claim | undefined {
  return CLAIMS.find((c) => c.id === id)
}
