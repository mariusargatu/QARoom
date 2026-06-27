import { z } from 'zod'
import { MatrixTier } from './detection-matrix-schema'

/**
 * The detection-matrix toggle manifest: every deliberate-bug env toggle in the repo, with where
 * it is read, how it is armed, and what was DESIGNATED to catch it. The matrix experiment
 * (scripts/detection-matrix.ts) generalizes `pnpm prove <id> --break` from one designated gate to
 * the whole battery: arm each toggle, run everything, record every technique's verdict. Sibling
 * of claims.ts: claims are the permanent gates; this manifest is the experiment's ground truth.
 *
 * The census rule: a toggle may only be listed if non-test code actually reads its env var
 * (`pnpm matrix --verify` greps each readSite, mirroring claims-verify's checkWired): the
 * manifest can never name a toggle nothing reads. The same census checks each declared
 * `guard` against the read site, so guard metadata cannot drift from the code.
 */
export const ToggleTiming = z.enum([
  /** Read on every call: external env injection is honored mid-process. */
  'call-time',
  /** Read once when the server/object is built: tests reusing a prebuilt fixture miss it. */
  'construction-time',
  /** Read when pydantic Settings() loads: Python; per-test settings fixtures honor it. */
  'settings-load',
])
export type ToggleTiming = z.infer<typeof ToggleTiming>

export const ToggleGuard = z.enum([
  /** The read site honors the env var unconditionally: armable anywhere, including live pods. */
  'unguarded',
  /** Wrapped in NODE_ENV !== 'production': inert on deployed pods, so live-tier cells are n/a. */
  'node-env-gated',
  /** A pydantic Settings field (Python): armable wherever Settings() loads. */
  'settings-load',
])
export type ToggleGuard = z.infer<typeof ToggleGuard>

export const DetectionToggle = z.object({
  id: z.string(),
  env: z.object({ name: z.string(), value: z.string() }),
  component: z.string(),
  readSite: z.object({ file: z.string(), timing: ToggleTiming }),
  /** What the read site does with the env var — census-verified against the code, never asserted.
   *  node-env-gated drives the cluster tier's auto-n/a (the toggle is inert on live pods). */
  guard: ToggleGuard,
  /** What the repo SAYS catches this (null = nothing references the env; purely empirical). */
  designatedCatcher: z.string().nullable(),
  /** Cross-ref into claims.ts when this toggle already backs a permanent claim. */
  claimId: z.string().optional(),
  tiers: z.array(MatrixTier).min(1),
  /** Test files that arm/clear this env THEMSELVES (vitest file isolation contains it, but
   *  their verdicts under external injection invert: annotate, never naively count). */
  selfToggling: z.array(z.string()),
  notes: z.string().optional(),
})
export type DetectionToggle = z.infer<typeof DetectionToggle>

export const TOGGLES: DetectionToggle[] = z.array(DetectionToggle).parse([
  // ── messaging / otel (shared infrastructure: expect wide blast radius, H6) ──
  {
    id: 'skip-dedup',
    env: { name: 'CHAOS_SKIP_DEDUP', value: '1' },
    component: 'messaging',
    readSite: { file: 'packages/messaging/src/subscribe.ts', timing: 'call-time' },
    guard: 'unguarded',
    designatedCatcher: null,
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'Tier-A: caught by unit+integration+property (widest in-proc blast radius, H6). Tier-B ' +
      '(2026-06-10, reset+paced battery): all live cells MISSED on calm traffic as predicted: ' +
      "dedup loss needs REDELIVERY, i.e. the chaos 03 experiment; the first sweep's tracetest " +
      "'catch' was rollout-state pollution, withdrawn.",
  },
  {
    id: 'tenant-span-drop',
    env: { name: 'CHAOS_TENANT_SPAN_DROP', value: '1' },
    component: 'otel',
    readSite: { file: 'packages/otel/src/tenant-span-processor.ts', timing: 'call-time' },
    guard: 'unguarded',
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
    readSite: { file: 'services/content/src/config/faults.ts', timing: 'construction-time' },
    guard: 'unguarded',
    designatedCatcher: null,
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'Tier-A v1 verdict (2026-06-10): ALL MISSED: content.spec.ts asserted a created post ' +
      'APPEARS in the feed, never its ORDER; a reversed feed passed the entire battery. Hole ' +
      'closed same day by tests/feed-order.spec.ts (newest-first pinned); row re-ran ✗ to ✓. The ' +
      'matrix-finds-hole -> fix -> re-run loop, demonstrated.',
  },
  {
    id: 'vote-slow',
    env: { name: 'CONTENT_BUG_VOTE_SLOW_MS', value: '800' },
    component: 'content',
    readSite: { file: 'services/content/src/config/faults.ts', timing: 'construction-time' },
    guard: 'unguarded',
    designatedCatcher: 'load-tests/vote-cast.js (k6 SLO gate, exit 99)',
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'H3 probe: predicted MISSED by every functional technique in-proc (suites get slower, not ' +
      'redder) and caught only by the k6 SLO threshold: performance bugs need a performance gate.',
  },
  {
    id: 'vote-out-of-range',
    env: { name: 'CONTENT_BUG_VOTE_OUT_OF_RANGE', value: '1' },
    component: 'content',
    readSite: { file: 'services/content/src/config/faults.ts', timing: 'construction-time' },
    guard: 'unguarded',
    designatedCatcher:
      'services/content/src/repository/votes.test.ts (Zod-derived ±1 property) + DB CHECK votes_value_check',
    claimId: 'vote-value-in-band',
    tiers: ['in-proc'],
    selfToggling: [],
    notes:
      'Phase-1 of the verifiable-invariants experiment (ADR-0024). Writes value*7 instead of the ' +
      'validated ±1; the DB CHECK (derived from contracts VOTE_VALUES) rejects it, turning the ' +
      'vote-value property red. Backs the permanent `vote-value-in-band` claim ' +
      '(pnpm prove vote-value-in-band --break). The DB constraint is a SECOND independent catcher: ' +
      'any votes.spec/test that casts a vote also reds under this toggle (constraint violation).',
  },
  {
    id: 'tenant-leak',
    env: { name: 'CONTENT_BUG_TENANT_LEAK', value: '1' },
    component: 'content',
    readSite: { file: 'services/content/src/config/faults.ts', timing: 'construction-time' },
    guard: 'unguarded',
    designatedCatcher: 'services/content/src/tenancy.property.test.ts (property-based isolation)',
    claimId: 'tenant-isolation',
    tiers: ['in-proc'],
    selfToggling: [],
    notes:
      "Loosens listFeed's per-community WHERE to an always-true predicate, so every tenant's feed " +
      'returns all posts (Commitment 9). Designated catcher is the three-tenant interleave property; ' +
      'backs the permanent `tenant-isolation` claim (pnpm prove tenant-isolation --break).',
  },
  {
    id: 'sync-publish',
    env: { name: 'CHAOS_SYNC_PUBLISH', value: '1' },
    component: 'content',
    readSite: { file: 'services/content/src/config/faults.ts', timing: 'construction-time' },
    guard: 'unguarded',
    designatedCatcher: 'scripts/k6-under-chaos.sh 02-net-slow-nats vote-cast (chaos × load)',
    tiers: ['cluster'],
    selfToggling: [],
    notes:
      'Tier-B verdict (2026-06-10), prediction FALSIFIED the good way: plain k6 catches it on a ' +
      'HEALTHY broker (exit 99): the per-request outbox drain alone breaches the vote SLO; chaos ' +
      'multiplies the magnitude. Not composition-ONLY at gate sensitivity, so the claim gate can ' +
      'be plain k6. Candidate permanent claim: outbox-isolates-broker-latency.',
  },
  // ── flags ──
  {
    id: 'canary-misroutes',
    env: { name: 'FLAGS_BUG_CANARY_MISROUTES', value: '1' },
    component: 'flags',
    readSite: { file: 'services/flags/src/repository.ts', timing: 'call-time' },
    guard: 'node-env-gated',
    designatedCatcher: null,
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'Tier-B verdict (2026-06-10): the deployed pods run NODE_ENV=production, so the toggle is ' +
      'INERT live: cluster cells are n/a, not misses (the first row run false-caught on rollout ' +
      'state pollution before the reset fix). In-proc integration+MBT are the real detectors.',
  },
  // ── gateway ──
  {
    id: 'disable-circuit-breaker',
    env: { name: 'CHAOS_DISABLE_CIRCUIT_BREAKER', value: '1' },
    component: 'gateway',
    readSite: { file: 'services/gateway/src/server.ts', timing: 'construction-time' },
    guard: 'unguarded',
    designatedCatcher: 'services/gateway/tests/circuit-breaker.spec.ts',
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'Tier-A: ALL MISSED in-proc, structurally: the designated spec constructs new ' +
      'CircuitBreaker(...) directly while the toggle disables the WIRING in server.ts. Tier-B ' +
      '(2026-06-10): caught live by PACED Schemathesis: its traffic through the known-sick ' +
      'donations upstream (Microcks /charges 404 -> 502) makes the missing breaker leak naked ' +
      '500s. Emergent detection: fuzz × an accidentally sick upstream; with healthy upstreams ' +
      'this too would be invisible.',
  },
  {
    id: 'upstream-timeout',
    env: { name: 'GATEWAY_UPSTREAM_TIMEOUT_MS', value: '600000' },
    component: 'gateway',
    readSite: { file: 'services/gateway/src/upstream-call.ts', timing: 'call-time' },
    guard: 'unguarded',
    designatedCatcher: 'tests/chaos/07-net-partition-gateway-donations.test.ts (live partition)',
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'In-proc and Tier-B (paced) both ALL MISSED as predicted: a far-too-high timeout only ' +
      'bites when an upstream actually hangs; the chaos 07 partition experiment is the sole ' +
      "detector. The first sweep's schemathesis 'catch' was unpaced-429 noise, withdrawn.",
  },
  {
    id: 'contract-drift',
    env: { name: 'GATEWAY_BUG_DROP_EVENT_CURSOR', value: '1' },
    component: 'gateway',
    readSite: { file: 'services/gateway/src/events-routes.ts', timing: 'call-time' },
    guard: 'unguarded',
    designatedCatcher:
      'scripts/schemathesis-gate.sh (gateway response-schema validation vs the published openapi.yaml)',
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'Drops the required `cursor` field from the EventPage the gateway shapes on GET ' +
      '/api/communities/:id/events — response-contract drift on a read endpoint. The contract layer ' +
      'is what is designed to catch it (Pact + Pact-OAS in-proc, Schemathesis response validation ' +
      'live against openapi.yaml, where `cursor` is required and additionalProperties is false); the ' +
      'polling-parity integration test asserts only the events array, not the cursor.',
  },
  {
    id: 'events-skip-membership',
    env: { name: 'GATEWAY_BUG_SKIP_EVENTS_AUTHZ', value: '1' },
    component: 'gateway',
    readSite: { file: 'services/gateway/src/events-routes.ts', timing: 'call-time' },
    guard: 'unguarded',
    designatedCatcher:
      'gateway membership negative test (tests/ws-and-polling.spec.ts: a non-member poll must 403)',
    claimId: 'events-polling-membership',
    tiers: ['in-proc', 'cluster'],
    selfToggling: [],
    notes:
      'Skips the membership check on GET /api/communities/:id/events so an authenticated non-member ' +
      "reads another tenant's event stream — the cross-tenant leak the edge auth closes (ADR-0025). " +
      'The membership 403 test is the designated catcher; the polling-parity test only checks shape.',
  },
  // ── webhooks (Milestone 11: each property file self-arms its demo describe) ──
  {
    id: 'webhook-sign-body-only',
    env: { name: 'CHAOS_WEBHOOK_SIGN_BODY_ONLY', value: '1' },
    component: 'webhooks',
    readSite: { file: 'services/webhooks/src/worker.ts', timing: 'call-time' },
    guard: 'node-env-gated',
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
    guard: 'node-env-gated',
    designatedCatcher: 'services/webhooks/src/redelivery-dedup.property.test.ts',
    tiers: ['in-proc'],
    selfToggling: ['services/webhooks/src/redelivery-dedup.property.test.ts'],
  },
  {
    id: 'webhook-drop-on-fail',
    env: { name: 'CHAOS_WEBHOOK_DROP_ON_FAIL', value: '1' },
    component: 'webhooks',
    readSite: { file: 'services/webhooks/src/worker.ts', timing: 'call-time' },
    guard: 'node-env-gated',
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
    guard: 'node-env-gated',
    designatedCatcher: 'services/webhooks/src/retry-schedule.property.test.ts',
    tiers: ['in-proc'],
    selfToggling: ['services/webhooks/src/retry-schedule.property.test.ts'],
  },
  {
    id: 'webhook-illegal-transition',
    env: { name: 'CHAOS_WEBHOOK_ILLEGAL_TRANSITION', value: '1' },
    component: 'webhooks',
    readSite: { file: 'services/webhooks/src/worker.ts', timing: 'call-time' },
    guard: 'node-env-gated',
    designatedCatcher: 'services/webhooks/tests/reverse-conformance.spec.ts',
    tiers: ['in-proc', 'cluster'],
    selfToggling: ['services/webhooks/tests/reverse-conformance.spec.ts'],
    notes:
      'H7 answered (2026-06-10): live tracetest MISSED: the committed def asserts the CREATE ' +
      'trace and the illegal transition lives in the delivery WORKER, which that trigger never ' +
      'exercises. The in-proc reverse-conformance spec is load-bearing; the live tier added ' +
      'environmental realism, zero detection.',
  },
  // ── moderator-agent (Python; env -> pydantic Settings at load) ──
  {
    id: 'moderator-disable-input-guard',
    env: { name: 'MODERATOR_DISABLE_INPUT_GUARD', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    guard: 'settings-load',
    designatedCatcher: 'services/moderator-agent/evals/redteam/test_deepteam_owasp.py',
    tiers: ['in-proc', 'llm'],
    selfToggling: ['services/moderator-agent/evals/redteam/test_deepteam_owasp.py'],
    notes:
      'Tier-C verdict (2026-06-10): MISSED by every llm group: pinned gpt-5.5 resists the ' +
      'injection even unguarded (deliberate LLM bugs rot). RESOLVED: the behavioural demo is now ' +
      'a recorded metric (SKIPs when unmeasurable, never false-green), and the durable teeth moved ' +
      'to the deterministic guard-mechanism claim `input-guard-fences-untrusted-body` ' +
      '(prove --break) + tests/test_config_defaults.py. Only deterministic gates earn teeth now ' +
      '(evals/README.md).',
  },
  {
    // The INDIRECT-injection sibling (2026-06-15): the corpus channel rather than the post body. A
    // poisoned PRECEDENT (corpus derives from past post bodies) is a stored injection — OWASP ASI01.
    id: 'moderator-disable-corpus-guard',
    env: { name: 'MODERATOR_DISABLE_CORPUS_GUARD', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    guard: 'settings-load',
    designatedCatcher: 'services/moderator-agent/tests/test_corpus_guard.py',
    claimId: 'retrieved-context-fenced',
    tiers: ['in-proc', 'llm'],
    selfToggling: ['services/moderator-agent/tests/test_corpus_guard.py'],
    notes:
      'Tier-A: caught keyless by the deterministic corpus-guard test (the fence is a pure string ' +
      'transform — cannot rot). The llm tier is the ASI-2026 red-team (test_asi_2026.py) which ' +
      'MEASURES whether a stored injection flips a disposition with the guard off — a tracked metric, ' +
      'not a gate, since the behavioural payoff moves with the model (evals/README.md).',
  },
  {
    id: 'moderator-prompt-bug',
    env: { name: 'MODERATOR_PROMPT_BUG', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    guard: 'settings-load',
    designatedCatcher: 'services/moderator-agent/tests/test_metamorphic.py (llm-marked)',
    tiers: ['in-proc', 'llm'],
    selfToggling: [],
    notes:
      'The metamorphic catcher needs OPENAI_API_KEY: the in-proc row shows what keyless CI sees.',
  },
  {
    id: 'moderator-ungrounded',
    env: { name: 'MODERATOR_UNGROUNDED', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    guard: 'settings-load',
    designatedCatcher: 'services/moderator-agent/evals/deepeval/test_rag_metrics.py (faithfulness)',
    tiers: ['in-proc', 'llm'],
    selfToggling: ['services/moderator-agent/evals/deepeval/test_rag_metrics.py'],
    notes:
      'Tier-C verdict (2026-06-10): MISSED: the hallucination demo self-arms (explicit ' +
      'Settings(moderator_ungrounded=True)), and on gold cases the model cites real retrieved ' +
      'rules even with the grounding check off: the guard is a safety net under a model that ' +
      'rarely needs it. New keyless catcher: tests/test_config_defaults.py.',
  },
  {
    id: 'moderator-disable-abstain',
    env: { name: 'MODERATOR_DISABLE_ABSTAIN', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    guard: 'settings-load',
    designatedCatcher: 'services/moderator-agent/tests/test_selfcheck.py',
    claimId: 'moderator-abstain',
    tiers: ['in-proc', 'llm'],
    selfToggling: ['services/moderator-agent/tests/test_selfcheck.py'],
    notes:
      'Tier-A: caught by py-conformance (test_workflow_decision builds the graph from bare ' +
      'Settings: the one moderator test that sees env). Tier-C (2026-06-10): MISSED: gold ' +
      'cases are unanimous, abstain never fires on them, so disabling it changes nothing the ' +
      'metrics see. New keyless catcher: tests/test_config_defaults.py.',
  },
  {
    id: 'moderator-disable-approve-guard',
    env: { name: 'MODERATOR_DISABLE_APPROVE_GUARD', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    guard: 'settings-load',
    designatedCatcher: 'services/moderator-agent/tests/test_selfcheck.py',
    claimId: 'moderator-no-confident-approve-of-flag',
    tiers: ['in-proc'],
    selfToggling: ['services/moderator-agent/tests/test_selfcheck.py'],
    notes:
      'The safety invariant (never confidently approve flagged content): the approve-side mirror of ' +
      'disable-abstain. Deterministic, keyless teeth — self_check escalates a confident approve that ' +
      'diverges from majority-remove precedent; the toggle ships it as approve. This is the bar that ' +
      'lets the cheaper gpt-5-nano draft model stay safe (gold agreement is only a screen).',
  },
  {
    id: 'moderator-rerank-bug',
    env: { name: 'MODERATOR_RERANK_BUG', value: '1' },
    component: 'moderator',
    readSite: {
      file: 'services/moderator-agent/src/moderator_agent/config.py',
      timing: 'settings-load',
    },
    guard: 'settings-load',
    designatedCatcher: 'services/moderator-agent/tests/test_reranker.py',
    tiers: ['in-proc', 'llm'],
    selfToggling: [],
    notes:
      'H1 probe: predicted single-point-of-detection (delete test_reranker.py and this ships).',
  },
  // ── web (the first FRONTEND toggle: a UI bug caught at the lowest tier, not by driving the system) ──
  {
    id: 'ws-no-dedup',
    env: { name: 'WEB_BUG_WS_NO_DEDUP', value: '1' },
    component: 'web',
    readSite: {
      file: 'services/web/src/hooks/useWsWithPollingFallback.ts',
      timing: 'call-time',
    },
    guard: 'node-env-gated',
    designatedCatcher: 'services/web/src/hooks/useWsWithPollingFallback.property.test.ts',
    claimId: 'ws-merge-dedup',
    tiers: ['in-proc'],
    selfToggling: [],
    notes:
      'The WS push + polling fallback both replay the backlog, so the merge MUST dedup by per-community ' +
      'seq or the same envelope renders twice (duplicate React keys, doubled rows). The pure `prepend` ' +
      'reducer is the read site; a fast-check property over overlapping prev/incoming feeds catches it ' +
      'in-proc — the UI bug reproduced by writing the inputs down, not by a 500-client storm.',
  },
  // ── agentic (Boundary 16, ADR-0032): the agent attacks the GATES, not just the product. Each
  // toggle models a named attack from the taxonomy (ImpossibleBench/METR/Anthropic) against a
  // verifier. The fourth proposed claim (tool-trajectory reverse-conformance) is DEFERRED to T21. ──
  {
    id: 'agent-desync-openapi',
    env: { name: 'AGENT_DESYNC_OPENAPI', value: '1' },
    component: 'agentic',
    readSite: {
      file: 'services/content/src/contract/openapi-document.ts',
      timing: 'call-time',
    },
    guard: 'unguarded',
    designatedCatcher:
      'services/content/tests/openapi-roundtrip.spec.ts (Zod round-trip) + scripts/openapi-verify.ts (drift gate)',
    claimId: 'agent-cannot-silently-desync',
    tiers: ['in-proc'],
    selfToggling: [],
    notes:
      'Models an agent that hand-edits the generated artifact (or drifts the Zod schema) and leaves ' +
      'the committed openapi.yaml behind. Armed, contentOpenApiYaml() drifts, so the read-only ' +
      'round-trip spec reds AND `pnpm openapi:verify` reds. Backs `agent-cannot-silently-desync`.',
  },
  {
    id: 'agent-emit-assertionless-test',
    env: { name: 'AGENT_EMIT_ASSERTIONLESS_TEST', value: '1' },
    component: 'agentic',
    readSite: {
      file: 'packages/testing-utils/src/agentic/assertion-teeth.ts',
      timing: 'call-time',
    },
    guard: 'unguarded',
    designatedCatcher:
      'packages/testing-utils/src/agentic/assertion-teeth.test.ts (mutation-kill gate, the in-proc twin of pnpm stryker:harness — ADR-0031)',
    claimId: 'agent-test-has-teeth',
    tiers: ['in-proc'],
    selfToggling: [],
    notes:
      'The always-pass / `__eq__`→True attack: agentAssert stops asserting, every mutant of the target ' +
      'survives, the kill ratio falls to 0, and the mutation gate reds. Backs `agent-test-has-teeth`.',
  },
  {
    id: 'agent-patch-around-gate',
    env: { name: 'AGENT_PATCH_AROUND_GATE', value: '1' },
    component: 'agentic',
    readSite: { file: 'services/content/src/config/faults.ts', timing: 'construction-time' },
    guard: 'unguarded',
    designatedCatcher:
      'services/content/tests/agent-gaming.spec.ts (the tenant-isolation invariant) + services/content/src/tenancy.property.test.ts',
    claimId: 'gate-survives-agent-gaming',
    tiers: ['in-proc'],
    selfToggling: [],
    notes:
      'Re-uses the tenancy leak as the bug an agent patches in behind green-theater tests (it loosens ' +
      "listFeed's per-community WHERE, so it also reds the existing tenant-isolation property). The " +
      'strong invariant gate reds while the weak-oracle agent test stays green. Backs ' +
      '`gate-survives-agent-gaming`.',
  },
])

export const toggleById = (id: string): DetectionToggle | undefined =>
  TOGGLES.find((t) => t.id === id)

/**
 * Technique-group classification by file path: ORDER MATTERS (first match wins). One vitest
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
