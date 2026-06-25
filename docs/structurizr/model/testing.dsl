# The TESTING ARCHITECTURE as a first-class model (custom elements + relationships), rendered by
# views/testing-views.dsl. This is the "central artifact": every architectural boundary, the
# technique(s) that defend it, the honeycomb tier each technique lives in, the eleven falsifiable
# claims, and the contract-triangulation gates.
#
# SOURCES OF TRUTH (keep this file a faithful projection of them):
#   - Boundaries  -> scripts/lib/manifests/boundary-registry.ts  (12 rows; `pnpm boundaries:render`)
#   - Claims      -> scripts/lib/manifests/claims.ts             (11 claims; `pnpm claims:verify`)
#   - Techniques  -> ARCHITECTURE.md §3 (honeycomb bands + the gated boundary map) + the tests
#   - Tiers       -> ARCHITECTURE.md §3 (cap / integration band / E2E base) and docs/gauntlet.md
# When a boundary or claim changes in the manifest above, update the matching element here.
# Custom-element form is positional: element "Name" "Metadata" "Description" "Tags".

# ============================ The 12 architectural boundaries ============================
group "Architectural boundaries" {
    bTrust         = element "Trust (client to gateway)"            "boundary" "Breaks on: malformed or hostile input" "Boundary"
    bProcessRest   = element "Process (service to service)"         "boundary" "Breaks on: a contract drifting between two services" "Boundary"
    bProcessAsync  = element "Async (events over NATS)"             "boundary" "Breaks on: a lost, duplicated, or reordered event" "Boundary"
    bState         = element "State (rollout / delivery / migration)" "boundary" "Breaks on: an illegal state transition" "Boundary"
    bTemporal      = element "Temporal (wall-clock logic)"          "boundary" "Breaks on: logic that depends on the wall clock" "Boundary"
    bTenancy       = element "Tenancy (communities as tenants)"     "boundary" "Breaks on: one tenant reading another's data" "Boundary"
    bIdentity      = element "Identity issuance (JWT + JWKS)"       "boundary" "Breaks on: a retired key, a rotation that strands sessions" "Boundary"
    bWebsocket     = element "WebSocket push"                       "boundary" "Breaks on: a stale socket, an unauthorized subscription, push/poll divergence" "Boundary"
    bObservability = element "Observability (span structure)"       "boundary" "Breaks on: a span without its tenant, a trace that breaks" "Boundary"
    bExternalDep   = element "External dependency (the LLM moderator)" "boundary" "Breaks on: a hallucinated or overconfident decision" "Boundary"
    bPaymentEdge   = element "External payment (donations to provider)" "boundary" "Breaks on: the provider faulting/declining or its REST contract drifting" "Boundary"
    bDeliveryEdge  = element "Delivery edge (outbound webhooks)"     "boundary" "Breaks on: a replayed, dropped, or unsafe delivery" "Boundary"
}

# ============================ Techniques, by honeycomb tier ============================
# Tier A = the CAP + most of the integration BAND that runs in-process (Vitest/pytest, no cluster).
group "Tier A - in-process (Vitest / pytest)" {
    tUnit        = element "Unit (Vitest / pytest)"          "Tier A" "Logic bugs in pure functions; edge branches" "Technique"
    tProperty    = element "Property-based (fast-check)"     "Tier A" "Invariants over infinite inputs; tenancy interleave; voting; idempotency; retry/backoff; HMAC/SSRF" "Technique"
    tZod         = element "Zod schema validation"           "Tier A" "Strict request/response shapes at every edge; OAS pattern == parser regex" "Technique"
    tClock       = element "Injected Clock / Id / Randomness" "Tier A" "Determinism: no real time/uuid in business code (lint-enforced); seeds replay failures" "Technique"
    tPactRest    = element "Pact v4 (REST contract)"         "Tier A" "Consumer<->provider behaviour; JWKS contract" "Technique"
    tPactMsg     = element "Pact v4 (message contract)"      "Tier A" "Publisher<->subscriber event-shape agreement on a real captured envelope" "Technique"
    tCrosscheck  = element "Pact <-> OpenAPI cross-check"    "Tier A" "Static pact-vs-published-spec shape agreement" "Technique"
    tIntegration = element "Integration (PGlite)"            "Tier A" "Real-driver DB behaviour; transactional semantics; feed order; polling parity" "Technique"
    tComponent   = element "Storybook + Playwright CT + Screenplay" "Tier A" "Rendering, prop contracts, interaction logic; one Task runs as CT and E2E" "Technique"
    tMutation    = element "Stryker mutation (locked modules)" "Tier A" "Are the tests any good? Critical modules only (ADR-0016)" "Technique"
}

# Tier B = the E2E BASE: needs the live k3d cluster (real services + Chaos Mesh / Litmus).
group "Tier B - cluster-live (k3d)" {
    tSchemathesis = element "Schemathesis (stateful)"        "Tier B" "Spec-vs-running-impl fuzzing; stateful links; 5xx/crashes/spec-violations" "Technique"
    tEvomaster    = element "EvoMaster v6 (search-based)"    "Tier B" "Code paths beyond schema-driven coverage" "Technique"
    tMbt          = element "Model-based E2E (XState graph)" "Tier B" "All shortest paths from a hand-authored machine; sequence-dependent bugs" "Technique"
    tTracetest    = element "Tracetest (reverse-conformance)" "Tier B" "Asserts on trace STRUCTURE; system never enters off-model states; tenant.id present" "Technique"
    tMicrocks     = element "Microcks (virtualization)"      "Tier B" "Documented-but-rare payment-provider responses; WS-async mock" "Technique"
    tChaos        = element "Chaos Mesh + Litmus"            "Tier B" "Each experiment = a steady-state hypothesis in TS; infra + HTTP faults" "Technique"
    tK6           = element "k6 (load vs SLOs)"              "Tier B" "Server-side TTFB against the SLO table; gates feed/vote, observes donation" "Technique"
    tReplay       = element "Scenario replay (qaroom-replay)" "Tier B" "Capture DB + Lamport + clock seed; reload + replay under chaos" "Technique"
}

# Tier C = LLM EVALUATION: real-OpenAI, cost-guarded + key-gated (ADR-0017 / ADR-0020).
group "Tier C - LLM evaluation (key-gated)" {
    tDeepeval    = element "DeepEval (RAG / agentic / G-Eval)" "Tier C" "Faithfulness, contextual precision/recall, agentic success, judged quality" "Technique"
    tDeepteam    = element "DeepTeam (OWASP LLM Top 10)"     "Tier C" "Injection, prompt leakage, refusal bypass" "Technique"
    tPyrit       = element "PyRIT (multi-turn red-team)"     "Tier C" "Adversarial multi-turn conversations; jailbreaks" "Technique"
    tMetamorphic = element "Metamorphic paraphrase-invariance" "Tier C" "Output stable under semantic paraphrase; the golden+metamorphic pair catches prompt-bugs" "Technique"
    tLanggraphRC = element "LangGraph reverse-conformance"   "Tier C" "The graph never enters off-model states; xstate.transition spans match the model" "Technique"
}

# ---- technique DEFENDS boundary (the boundary map; lead techniques per boundary-registry.ts) ----
tSchemathesis -> bTrust "defends"
tZod          -> bTrust "defends"
tPactRest     -> bProcessRest "defends"
tCrosscheck   -> bProcessRest "defends"
tSchemathesis -> bProcessRest "defends (provider)"
tPactMsg      -> bProcessAsync "defends"
tTracetest    -> bProcessAsync "defends (propagation)"
tProperty     -> bProcessAsync "defends (dedup / at-least-once)"
tMbt          -> bState "defends"
tTracetest    -> bState "defends (reverse-conformance)"
tClock        -> bTemporal "defends"
tProperty     -> bTenancy "defends (three-tenant interleave)"
tProperty     -> bIdentity "defends (JWT properties)"
tPactRest     -> bIdentity "defends (JWKS contract)"
tComponent    -> bWebsocket "defends (Playwright WS)"
tIntegration  -> bWebsocket "defends (polling parity)"
tMicrocks     -> bWebsocket "defends (async mock)"
tTracetest    -> bObservability "defends"
tDeepeval     -> bExternalDep "defends"
tDeepteam     -> bExternalDep "defends"
tPyrit        -> bExternalDep "defends"
tMetamorphic  -> bExternalDep "defends"
tLanggraphRC  -> bExternalDep "defends"
tMicrocks     -> bPaymentEdge "defends"
tChaos        -> bPaymentEdge "defends (HTTPChaos)"
tProperty     -> bDeliveryEdge "defends (HMAC / SSRF / retry)"
tMbt          -> bDeliveryEdge "defends (delivery machine)"

# ============================ The 11 falsifiable claims ============================
# Each holds without its toggle and goes RED with it. `pnpm prove <id> --break`. (docs/claims.md)
group "Falsifiable claims (pnpm prove)" {
    clSign        = element "webhook-signing"        "CHAOS_WEBHOOK_SIGN_BODY_ONLY" "A signature binds the timestamp: a captured (body, signature) cannot be replayed." "Claim"
    clAtLeastOnce = element "webhook-at-least-once"  "CHAOS_WEBHOOK_DROP_ON_FAIL" "Every delivery reaches a terminal state; a failed send is retried, never dropped." "Claim"
    clAbstain     = element "moderator-abstain"      "MODERATOR_DISABLE_ABSTAIN" "Escalates to a human on low confidence instead of guessing." "Claim"
    clApprove     = element "moderator-no-confident-approve-of-flag" "MODERATOR_DISABLE_APPROVE_GUARD" "An approve that diverges from majority-remove precedent escalates instead." "Claim"
    clInputGuard  = element "input-guard-fences-untrusted-body" "MODERATOR_DISABLE_INPUT_GUARD" "Fences attacker-controlled bodies as DATA before the model." "Claim"
    clCorpusGuard = element "retrieved-context-fenced" "MODERATOR_DISABLE_CORPUS_GUARD" "Fences poisoned precedents / policy text as DATA." "Claim"
    clVote        = element "vote-value-in-band"     "CONTENT_BUG_VOTE_OUT_OF_RANGE" "A stored vote is exactly +1 or -1; the +/-1 rule lives in one place (VOTE_VALUES) and the schema, DB CHECK, OpenAPI, and property generator all derive from it (ADR-0024)." "Claim"
    clTenant      = element "tenant-isolation"       "CONTENT_BUG_TENANT_LEAK" "A feed contains exactly its own posts under any cross-community interleave." "Claim"
    clEventsPoll  = element "events-polling-membership" "GATEWAY_BUG_SKIP_EVENTS_AUTHZ" "The events polling fallback enforces community membership: a non-member is refused (403), so REST cannot leak another tenant's event stream (ADR-0025)." "Claim"
    clSpan        = element "tenant-span-everywhere" "CHAOS_TENANT_SPAN_DROP" "Every emitted span carries tenant.id; a dropped stamp is caught by the live Jaeger audit." "Claim"
    clOutbox      = element "outbox-isolates-broker-latency" "CHAOS_SYNC_PUBLISH" "The outbox keeps mutating-HTTP latency independent of the broker." "Claim"
}

# NOTE: webhook-signing/at-least-once map to delivery-edge (the reader-facing registry row + the
# FalsifiableClaims view), NOT to their claims.ts gate LANE (trust / process-async). ARCHITECTURE.md §4.
clSign        -> bDeliveryEdge "falsifies"
clAtLeastOnce -> bDeliveryEdge "falsifies"
clAbstain     -> bExternalDep "falsifies"
clApprove     -> bExternalDep "falsifies"
clInputGuard  -> bExternalDep "falsifies"
clCorpusGuard -> bExternalDep "falsifies"
clVote        -> bProcessRest "falsifies"
clTenant      -> bTenancy "falsifies"
clEventsPoll  -> bTenancy "falsifies (REST fallback)"
clSpan        -> bObservability "falsifies"
clOutbox      -> bProcessAsync "falsifies"

# ============================ Contract triangulation (drift gates) ============================
# Zod is the single source; OpenAPI/AsyncAPI are generated + committed; Pact is independently
# authored. Four tools never collapse because each checks a DIFFERENT direction of agreement.
group "Contract triangulation" {
    gZod      = element "Zod schemas"        "single source" "The single source of truth (@qaroom/contracts)" "Source"
    gOpenapi  = element "OpenAPI (generated, committed)" "artifact" "Per-service openapi.yaml; byte-identical to a fresh regen" "Artifact"
    gAsyncapi = element "AsyncAPI (generated, committed)" "artifact" "Event channels; @asyncapi/diff drift gate (ADR-0002)" "Artifact"
    gPact     = element "Pact files (consumer-authored)" "artifact" "An independent second source of truth" "Artifact"
    gOasdiff  = element "oasdiff" "spec-was vs spec-now" "Undeclared breaking changes over time" "Gate"
}
gZod          -> gOpenapi  "generates"
gZod          -> gAsyncapi "generates"
gPact         -> gOpenapi  "cross-checked vs"
tCrosscheck   -> gOpenapi  "static shape agreement"
gOasdiff      -> gOpenapi  "diffs over time"
tSchemathesis -> gOpenapi  "spec vs running impl"
tPactRest     -> gPact     "authored by the consumer"

# ============================ Governance / evidence tier ============================
group "Evidence + governance" {
    gSummary  = element "test-results/summary.json" "frozen schema" "The envelope every runner folds into; what agentic CI consumes" "Gate"
    gClaimsV  = element "pnpm claims:verify" "gate" "Every claim resolves + empirically goes RED under its toggle; byte-gates the rendered boundary/claim tables" "Gate"
    gMatrixV  = element "pnpm matrix:verify" "gate" "The bug x technique detection matrix does not drift (hash-stamped)" "Gate"
    gBoundV   = element "pnpm boundaries:render" "gate" "The ARCHITECTURE.md §3 boundary table is the gated projection of boundary-registry.ts" "Gate"
    gMcpV     = element "pnpm mcp:verify" "gate" "MCP manifest drift + typed breaking-change classifier" "Gate"
    gGauntlet = element "pnpm gauntlet" "orchestrator" "Every technique, one orchestrated run vs one live system; honest infra/gate/observe semantics" "Gate"
}
gClaimsV  -> gSummary "reads evidence from"
gMatrixV  -> gSummary "reads evidence from"
gGauntlet -> gSummary "folds every lane into"
gBoundV   -> bTrust   "renders the registry that includes"
