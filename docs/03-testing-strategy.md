# QARoom: Testing Strategy

*The strategy as designed: where it describes CI cadence it describes the designed loops, while the current reality is manual-dispatch CI (see [AGENTS.md "CI gates"](../AGENTS.md)). The living state is the [README](../README.md) and [docs/04-roadmap.md](04-roadmap.md).*

This document is the keystone of the project. The architecture exists to enable this strategy; the strategy exists because the architecture was designed to admit it. Reading this document standalone should tell you what we test, where we test it, why we test it that way, and what we deliberately do not test.

Contents:

- [1. Goals and non-goals](#1-goals-and-non-goals)
- [2. The complexity constraint](#2-the-complexity-constraint)
- [3. The risk model](#3-the-risk-model)
- [4. The portfolio: the honeycomb, layer by layer](#4-the-portfolio-the-honeycomb-layer-by-layer)
- [5. The technique-to-boundary map](#5-the-technique-to-boundary-map)
- [6. Triangulation: defending against silent drift](#6-triangulation-defending-against-silent-drift)
- [7. Determinism and observability: the strategy preconditions](#7-determinism-and-observability-the-strategy-preconditions)
- [8. Feedback architecture](#8-feedback-architecture)
- [9. The test code as a system](#9-the-test-code-as-a-system)
- [10. The learning loop](#10-the-learning-loop)
- [11. Explicit exclusions](#11-explicit-exclusions)
- [12. Service-level objectives (demo-grade)](#12-service-level-objectives-demo-grade)
- [13. Map back to the architecture](#13-map-back-to-the-architecture)

## 1. Goals and non-goals

### Goals

- **Demonstrate the testing techniques in their natural architectural habitats.** Each technique is placed where the boundary it protects actually lives, not where it is convenient.
- **Make the architecture-testing relationship visible.** A reader should be able to look at any boundary in QARoom and name the technique that defends it.
- **Prove the techniques are complementary, not redundant.** Where they overlap (e.g., Pact and Schemathesis both generate API calls), the differences in what they catch are made explicit, not glossed.
- **Lock the substrate before the agents arrive.** Test outputs, observability, and capture/replay are designed so future LLM agents can participate in testing without rework.

### Non-goals

- **This is not a production-grade test suite.** Some techniques (chaos, load, search-based fuzzing) would not appear in the first 18 months of a real product's life. They are here because they are educational.
- **This is not a survey of every testing tool.** Each tool earns its place by demonstrating a distinct testing philosophy. Decorative tools are excluded.
- **This is not optimized for coverage.** Coverage is a vanity metric. Confidence per dollar is the real currency.

## 2. The complexity constraint

QARoom resists feature richness. Every architectural element (every service, table, endpoint, abstraction) exists because without it, a specific testing demonstration would be impossible or unconvincing. When the project tempts toward adding behavior "for realism," the question is asked: *does this enable a testing technique we haven't demonstrated yet?* If no, it is cut.

Specific exclusions:
- Comment threading beyond one level: adds no testing surface, removed.
- Multiple feature flags beyond donations: adds combinatorial complexity without new technique, removed.
- Multiple user roles beyond owner/member: adds no isolation surface that two roles don't cover, removed.
- A migration narrative parallel to the donations rollout: doubles the state machine surface for one extra demonstration, deferred to a future series.

This constraint is a contract with the reader: when they encounter complexity in QARoom, they can trust it earns its place.

## 3. The risk model

QARoom is a teaching project, not a production system. Its "production-equivalent failure" is *pedagogical*: a reader follows the project and walks away with wrong ideas, or with techniques they cannot apply, or with a sense that the testing was performative.

The strategy is optimized for *teaching clarity*, not for *catching the maximum number of bugs in a hypothetical production deployment*. This shifts several decisions:

- Tests with clear teaching value beat tests with high statistical bug-catch rate.
- Tools that demonstrate distinct philosophies beat tools that incrementally improve coverage.
- Honest documentation of what each technique misses beats the appearance of completeness.

The risk this strategy is most exposed to is **technique-overlap confusion**: two tools that both generate API calls (Pact, Schemathesis) without clear delineation will read as redundant. The mitigation is the per-tool "what this catches that nothing else does" framing, applied ruthlessly throughout.

## 4. The portfolio: the honeycomb, layer by layer

The portfolio is a **honeycomb**, not a pyramid (ARCHITECTURE.md §3): a thin **cap** (unit + mutation on locked critical modules, no I/O), a fat **integration band** that carries the weight, and a thin **E2E base** (chaos, load) that runs merge-to-main / nightly. Most of the layers below sit in that fat middle, because in microservices the bugs that matter live *between* services: cross-service contract, async, and state drift. §5 then splits that band by boundary.

| Layer | Primary tools | What it catches | Explicitly does not catch | Where it runs |
|---|---|---|---|---|
| **Unit** | Vitest | Logic bugs in pure functions, edge-case branches, boundary arithmetic | Anything involving I/O, time, integration with other services | Developer machine; PR CI |
| **Property** | fast-check | Invariants that hold across infinite inputs; tenant isolation; voting score correctness | Behaviors that need a specific input the developer thought to write | PR CI |
| **Schema validation** | Zod runtime + OpenAPI + oasdiff | Drift between code and contract; payloads that violate spec | Whether the *contract itself* is correct | PR CI (oasdiff blocks breaking changes) |
| **REST contract** | Pact v4 | Consumer-perceived breakages of provider contracts; consumer evolution | Bugs in payloads consumers don't actually use | PR CI |
| **Async contract** | Pact v4 message | Mismatched message shapes between publisher and subscriber | NATS-specific delivery semantics (durability, redelivery) | PR CI |
| **API schema fuzzing** | Schemathesis | Server crashes on edge-case inputs; schema-violating responses; stateful workflow errors (with `--stateful=links`) | Bugs that require domain knowledge to trigger | Nightly; on schema change |
| **Search-based fuzzing** | EvoMaster v6 | Code paths and edge cases that schema-driven tools haven't reached | Bugs requiring application semantics beyond the schema | Nightly |
| **Integration** | Vitest + in-process PGlite (no Docker); Testcontainers only where Pact provider verification needs a real Postgres | Database queries, real-driver behavior, transactional semantics | Cross-service interaction (covered by contract + E2E) | PR CI per service |
| **Component** | Storybook portable stories + Playwright CT + Screenplay | Rendering bugs, prop contracts, interaction logic in isolated components | Bugs that only manifest with real backend data or cross-component routing | PR CI (changed components); nightly (full) |
| **Model-based E2E** | XState + @xstate/graph + Playwright + Screenplay | State transitions, sequence-dependent bugs, donations rollout edge cases | Bugs in non-modeled flows | PR CI (shortest paths); nightly (simple paths) |
| **Trace-based** | Tracetest | Silent degradation: unexpected service calls, async ordering violations, missing spans | Bugs that don't manifest in trace structure | PR CI for critical flows; nightly broadly |
| **Service virtualization** | Microcks | Whether downstream-dependent code handles documented-but-rare responses | Whether the real downstream actually behaves as documented |  Used during integration and contract tests |
| **Chaos** | Chaos Mesh + Litmus | Cascading failures, missing fallbacks, behavior under infrastructure failure | Application-level bugs unrelated to infrastructure | Per-PR (focused experiments); merge-to-main (broader) |
| **Load** | k6 | Performance characteristics under realistic load; SLO violations | Functional bugs | Merge-to-main; nightly |
| **Mutation** | Stryker | Tests that pass even when the code is broken | Code that is broken in ways the tests don't cover at all | Weekly; on critical-module changes |
| **Scenario replay** | Custom `qaroom-replay` CLI | Bugs that intermittently surface; bugs that require specific state to reproduce | Bugs that need in-flight state we don't capture | Manual; triggered from failure artifacts |
| **LLM evaluation** *(Milestone 9; re-tooled Milestone 12)* | DeepEval (RAG, agentic, G-Eval quality) + DeepTeam (OWASP LLM Top 10) + PyRIT (multi-turn red-team) + metamorphic paraphrase-invariance + LangGraph reverse-conformance | Agent behavior drift; phrasing-sensitivity regressions a golden eval misses; off-model transitions; structured-output contract breaks | Non-LLM behaviors; bit-exact model output | Cost-guarded; push/schedule, key-gated (ADR-0017, ADR-0020) |

Each layer has a *responsibility* and an *explicit non-responsibility*. Without the non-responsibilities, layers overlap, costs balloon, and bugs fall through gaps.

The only layer that spends real money is that LLM evaluation lane. It is cost-bounded before it runs, and the estimate is itself a derived, drift-gated figure:

<!-- cost:start (generated by `pnpm cost:render --readme`; do not edit) -->
**LLM run cost (estimate).** One on-demand eval run, `openai:gpt-5-nano-2025-08-07`, at vendored prices:

| Lane | Est. tokens | Est. cost |
|---|--:|--:|
| `gold-deepeval` | 99,140 | $0.0071 |
| `deepteam-owasp` | 1,600 | $0.0004 |
| `pyrit-nightly` | 12,000 | $0.0027 |
| **total** | **112,740** | **$0.0102** |

<sub>Pre-flight estimate, not a measured bill: the eval harnesses (DeepEval/DeepTeam/PyRIT) report no token usage, so `pnpm --filter @qaroom/moderator-agent eval:cost` bounds the run against `MODERATOR_EVAL_BUDGET_TOKENS` and `cost:ledger` stamps the actual per-run record (with date) into `test-results/cost-ledger.json`. Prices are vendored in `evals/cost-model.json` — the `gpt-5.5` rate is a placeholder (no public price exists for a pinned future-dated model). Numbers derive from that file; `pnpm claims:verify` fails if this block drifts.</sub>
<!-- cost:end -->

## 5. The technique-to-boundary map

This is the central artifact of the strategy. Every architectural boundary in QARoom has a named testing technique that defends it. Looking at this map, an engineer should understand why each technique exists where it does. The eleven rows mirror `scripts/lib/manifests/boundary-registry.ts`, the registry the boundary map (ARCHITECTURE.md §3) is rendered from: same entries, same order.

| Boundary | Where it lives in QARoom | Technique that defends it | What that technique catches uniquely |
|---|---|---|---|
| **Trust (client to gateway)** | Client -> gateway | Schemathesis fuzzing + RFC 7807 conformance test | Server crashes on malformed input; spec-violating error responses |
| **Process (service to service)** | gateway <-> each backend service | Pact v4 + Schemathesis on the provider side, cross-checked against the published OpenAPI | Consumer-perceived contract breakage; spec-violating provider behavior |
| **Async (events over NATS)** | content-service and peers publish; flags-service, moderator-agent, and webhooks consume | Typed Zod events + outbox + `processed_events` dedup + Pact v4 message contracts + Tracetest propagation assertions | Message shape drift between publisher and subscriber; lost, duplicated, or reordered deliveries |
| **State (rollouts, webhook delivery, migration)** | Donations rollout, webhook delivery, and identity key migration machines | Hand-authored XState models + @xstate/graph + Playwright MBT; reverse-conformance on `xstate.transition` spans | Sequence-dependent and mid-transition bugs (e.g., request arrives during state change); off-model transitions |
| **Temporal** | Anywhere logic reads the clock: TTLs, expiries, retry backoff | Injected `Clock`; `FakeClock` advanced explicitly in tests; lint bans `new Date()` in non-test code | Wall-clock-dependent bugs reproduced deterministically, without sleeps or flake |
| **Tenancy (communities as tenants)** | Community A's data vs Community B's data | fast-check generated operation sequences, asserting no cross-tenant leakage | Isolation bugs the developer never wrote an example for |
| **Identity issuance (JWT and JWKS)** | identity-service issues JWT consumed by gateway and downstream | JWT property tests (issuance, validation, kid lookup, expiry, revocation); contract test for `JWKS` endpoint | Signing-key rotation drift; kid mismatches; expired-token acceptance |
| **WebSocket push** | Server -> client push (notifications, live feed) | AsyncAPI schema + Microcks-async mock + Playwright WS assertions; parity test against polling endpoint | Drift between WS events and the polling-fallback view; protocol-level shape regressions |
| **Observability** | What traces show vs what the system did | Tracetest assertions on trace structure | Unexpected service calls; missing spans; silent degradation that "works" but does extra work |
| **External dependency (the LLM moderator)** | moderator-agent <-> the model behind it (ADR-0020) | Retrieval grounding in the per-community policy corpus; DeepEval / DeepTeam / PyRIT evals; an abstain path (`escalate_to_human`) | Hallucinated or overconfident dispositions; phrasing-sensitivity regressions; injection and OWASP-LLM failures no deterministic layer sees |
| **Delivery edge (outbound webhooks)** | webhooks-service -> external receiver endpoints (ADR-0019) | HMAC-SHA256 signing with the timestamp bound in; SSRF guard; at-least-once delivery under the deterministic capped-jittered retry contract; webhook-delivery XState machine + MBT | Replayed or forged deliveries; callbacks aimed at internal addresses; dropped deliveries and retry-schedule drift |

The donations-service <-> payment provider hop (Microcks-mocked, Zod-validated, perturbed with Chaos Mesh / Litmus HTTPChaos) was this map's original external dependency; the registry now reserves that row for the LLM, and the payment hop stays defended by the §4 service-virtualization and chaos layers.

Three of these mappings deserve particular emphasis:

**Tenant isolation is the one class of bug only property-based testing catches systematically.** Cross-tenant leakage is categorical: example-based tests will rarely catch it, and in production it is catastrophic. fast-check generates arbitrary operation sequences across multiple tenants and asserts "no read from tenant A returns data created by tenant B". Milestone 2 demonstrates exactly this.

**The rollout machine is where model-based testing earns its keep.** A donation request that arrives in the middle of a flag transition has nondeterministic outcomes that no example-based test will exhaustively cover. The XState model enumerates valid states; @xstate/graph enumerates paths through them; Playwright drives the UI through each path and asserts the documented observable behavior at each state. Milestone 5 demonstrates this.

**Reverse conformance**, the guarantee that the running system never enters a state outside the model, is enforced separately from path-based MBT. Every XState actor emits an OpenTelemetry span (`xstate.transition`, attributes: `from`, `to`, `event`, `actor`) on every transition. The instrumentation wrapper lives in `packages/contracts/instrumentation/` and is the only entry point through which actors are created in production code. A Tracetest assertion in CI verifies that for every observed transition span, both `from` and `to` belong to the model's `states` set and `(from, event, to)` is a legal transition in the model. Drift between code and model is detected by a tracing-time check, not by an assumed correspondence.

**OpenTelemetry is a testing surface here, not a debugging aid.** Most teams stop at the debugging use; QARoom adds Tracetest assertions on the structure of traces, catching bugs where the system "works" by external API standards but is doing something wrong internally (calling a service it shouldn't, in an order it shouldn't, with spans missing). This is the demonstration that the OTel investment pays off in testing, not just in debugging.

## 6. Triangulation: defending against silent drift

The most underappreciated risk in modern testing is the auto-generated-artifact tautology: tests verify code matches a spec that was generated from the same code, so silent drift is invisible. QARoom defends against this with **bidirectional verification by adversarial sources**.

For every contract, at least two independently-authored artifacts express the truth, and verification fails loudly when they disagree.

### Concrete defenses

| Artifact | Authored by | Verified against |
|---|---|---|
| Zod schema | Developer (source of truth for current shape) | Runtime requests/responses; PR review |
| Generated OpenAPI YAML | Build step from Zod | Committed in repo; PR diff shows contract changes |
| Frozen `*.v1.yaml` spec at release | Snapshot of OpenAPI at release time | Current implementation must still satisfy it (backward compat job) |
| `oasdiff` check in CI | Automated diff | Fails PR on undeclared breaking changes |
| Pact contract files | Consumer's test code | Provider verification step; review on PR |
| Pact ↔ OpenAPI cross-check | Test in CI | Asserts Pact interactions are consistent with OpenAPI |
| XState model | Developer (hand-authored) | Conformance test asserts system reaches every state; reverse conformance asserts system never enters states not in the model |
| `/system/state` endpoint | Production code | Tracetest assertions; MBT state observations |
| Snapshot/replay format | Versioned Zod schema | Same drift gates as everything else |

The principle threading through these: **no single human action can silently change the meaning of a test.** Every change to expectations is either authored by hand in a human-readable spec, detected by a redundant test from a different angle, or flagged for explicit human review.

### The four contract tools, delineated

Four tools touch the API contract, and the single biggest teaching risk (§3) is that they read as redundant. They are not. Each tests a different *direction* of agreement, and no two collapse into one. This is the column an engineer should be able to recite at any boundary:

| Tool | Direction of agreement | Catches uniquely | Deliberately does **not** check |
|---|---|---|---|
| **Pact v4** | consumer ↔ *real* provider | breakage of behaviour the consumer actually depends on; consumer evolution | shapes no consumer uses; crashes; whether the provider's *published spec* agrees |
| **Pact ↔ OpenAPI cross-check** | pact ↔ *published* OpenAPI (shape) | a path/method/status/response-shape the consumer relies on that the spec never documents: drift between the pact and the published contract | example **values** (two valid ULIDs both pass); runtime behaviour |
| **`oasdiff`** | OpenAPI *was* ↔ OpenAPI *now* | undeclared breaking changes to the published contract over time | whether the contract matches the running code |
| **Schemathesis** | OpenAPI ↔ *running* implementation | 5xx/crashes and spec-violating responses on edge inputs; **stateful** link sequences (`--phases stateful` follows OAS `links`) | bugs requiring domain knowledge to trigger |

The cross-check is the one most easily mistaken for Pact or Schemathesis: it reads neither the running provider (Pact does) nor the implementation (Schemathesis does): only the *static* pact against the *static* published spec. It is the cheapest of the four and the one that catches "the consumer expects something the spec forgot to document."

### What we are honest about

Bidirectional verification has a cost. Adding a field to a donation request requires editing: the Zod schema, the consumer Pact test, the handler code, the OpenAPI is regenerated (and diff-reviewed), the XState model if the field affects flow, and possibly the snapshot schema. Each edit is small. The discipline is real.

We accept this cost because the alternative, silent drift, destroys the entire value of having tests. The strategy doc is explicit about this trade.

### What we explicitly reject

- **Snapshot tests** (`toMatchSnapshot()`, `--update-snapshots` workflows). They are a developer convenience that makes drift invisible. If they appear, they must be hand-authored and justified per test.
- **Generated-only contracts.** Any contract that is generated from code with no independent second source is forbidden. There is always a Pact, a frozen spec, or a property test backing it up.

## 7. Determinism and observability: the strategy preconditions

Several techniques in the portfolio require system properties that don't come for free. The strategy depends on them and names them explicitly.

### Determinism budget

QARoom distinguishes two layers of time and three sources of non-determinism. Each has a single, named control point:

| Source | Layer | Controlled via |
|---|---|---|
| Logical time (business TTLs, expiries, machine timers) | Logical | Injected `Clock`; production = real, tests = `FakeClock` advanced explicitly |
| OS wall clock (chaos perturbation, OTel timestamps) | OS | `TimeChaos` perturbs OS time; the **chaos manifest** (YAML) is captured into the snapshot so a replay can reapply it verbatim |
| UUIDs / IDs | - | Injected `IdGenerator`; tests use seeded deterministic sequences |
| Randomness (e.g., flag rollout sampling) | - | Injected `Randomness`; tests use seeded PRNG |
| HTTP timing | - | Toxiproxy or Chaos Mesh adds controlled latency, not OS-scheduled |
| Async ordering | - | Single-writer-per-resource; HTTP `Idempotency-Key`; async `Nats-Msg-Id` + `processed_events` dedup (Commitment 17) |
| Database | - | Postgres `random()` seeded per session; no auto-vacuum noise in tests |
| External services | - | Microcks deterministic responses keyed by request content |
| Message broker | - | NATS JetStream with deterministic consumer groups |

**Business logic reads only the injected `Clock`.** OS wall time is reserved for chaos and for OTel span timestamps; production code never observes it directly. Chaos runs remain replayable because the chaos manifest (the TimeChaos config: targets, skew direction, magnitude, duration) is part of the snapshot artifact (see Commitment 8); a replay reapplies the manifest against a fresh cluster.

**Leakage of non-determinism is treated as a P0 defect.** A direct `new Date()` call in business code, a `Math.random()` outside the `Randomness` interface, an unseeded UUID generation: these are bugs, not stylistic issues. They are caught by lint rules in Milestone 0.

### Observability contract

Every service must expose:
- `GET /system/state`: the current state of every model the service runs (XState machines, internal counters, etc.) in structured JSON. Every response wraps the payload in an `as_of: {snapshot_id, lamport, wall_clock}` envelope, read at Postgres `REPEATABLE READ` isolation. MBT and Tracetest assertions pin reads against `snapshot_id` so concurrent transitions do not flake the test.
- `GET /system/capabilities`: operations the service exposes, in MCP-tool-shaped JSON Schema
- `GET /system/snapshot` and `POST /system/snapshot`: scoped scenario capture and restore (bundle includes DB state, observable state, clock seed, lamport value, *and* any active chaos manifests; format versioned via `manifest.json` with `schema_version`)
- OpenTelemetry traces on every request, with `tenant.id` attribute on every span; `xstate.transition` spans for every state-machine transition
- RFC 7807 Problem Details for every non-2xx response

These are not optional. A service that does not expose them is incomplete. They are the substrate that the testing techniques depend on.

## 8. Feedback architecture

When tests run determines what they catch and what they cost. The strategy assigns each layer to a feedback loop with a latency budget. These are the designed lanes: CI currently runs on manual dispatch, and the same gates and more run locally via `pnpm gauntlet`.

| Loop | Latency budget | Flake budget | What runs |
|---|---|---|---|
| **Developer machine, pre-commit** | < 30 sec | 0% | Lint (Biome), type check (tsc) |
| **Developer machine, on save** | < 5 sec per file | < 0.5% | Unit tests for the changed file (Vitest watch) |
| **PR CI, fast** | < 10 min | < 1% | Unit + property + integration + REST contract + RFC 7807 conformance + oasdiff drift + Tracetest critical-flow assertions |
| **PR CI, full** | < 25 min | < 2% | Above + async contract + MBT shortest paths + Schemathesis (changed services) + Pact ↔ OpenAPI cross-check |
| **Merge to main** | < 45 min | < 3% | Above + MBT simple paths + load tests against SLOs + Tracetest broad assertions |
| **Nightly** | Unbounded | < 5% | Above + Schemathesis broad + EvoMaster v6 + chaos experiments + Stryker on critical modules |
| **Weekly** | Unbounded | n/a | Above + Stryker full + DeepEval / DeepTeam / PyRIT evals *(Milestones 9 and 12, key-gated)* |

**Flake budgets are intentional and emulate a real project.** Pre-commit and on-save use the developer machine and tolerate zero / < 0.5% because the loop is tight; CI loops are budgeted for KinD spin-up, shared-runner contention, and Testcontainers warm-up: sources of flake that no amount of test-code discipline will fully eliminate. A test that flakes more than its layer's budget is quarantined (skipped with a tracking issue) and treated as a bug: non-determinism (P0), an unreachable external service (wrong layer), or a layer-mismatch problem.

### How failures are localized

Each layer is designed so that a failure points to a specific cause:

- A failing unit test -> broken business logic in a known function
- A failing property test -> an invariant violated; the counter-example *and* the seed are included in the output (replay via `VITEST_SEED=<n>`)
- A failing contract test -> consumer and provider disagree; the disagreeing interaction is named
- A failing component test -> the Storybook story name + the Screenplay Task that failed + the assertion Question
- A failing MBT path -> the state transition the system failed to honor; the path itself is the trace
- A failing Tracetest assertion -> the trace span that violated the assertion; the trace ID is in the output
- A failing reverse-conformance assertion -> the off-model `xstate.transition` span with its `from`, `to`, `event` attributes
- A failing WS protocol test -> the AsyncAPI operation that drifted from the WS event observed; parity test names the polling endpoint that disagreed
- A failing idempotency property -> the duplicate-key sequence that produced divergent state
- A failing rate-limit property -> the input distribution that breached or under-counted
- A failing chaos experiment -> the documented failure mode that did not hold; the chaos manifest is in the output for replay
- A failing async dedup property -> the duplicate-`Nats-Msg-Id` sequence and the consumer that double-applied

If a layer's failures don't localize, that layer is failing as a testing technique even when it's catching bugs. The strategy is to fix the layer, not to live with the lack of signal.

## 9. The test code as a system

Test code is a first-class codebase. It has its own internal architecture, conventions, and contracts.

### Internal architecture

```text
packages/
  testing-utils/
    fixtures/             # Factory functions for domain objects, seeded
    generators/           # fast-check arbitraries for QARoom domain types
    harness/              # Test setup: containers, clock control, ID seeding
    matchers/             # Custom Vitest matchers (e.g., expectRFC7807, expectStateMachineAt)
    screenplay/           # Actors, Abilities, Tasks, Questions: shared vocabulary
    screenplay-system/    # Ability bindings for Playwright system tests (BrowseTheWeb, CallTheApi, ConsumeTheStream)
    screenplay-ct/        # Ability bindings for Playwright CT (BrowseTheStory) + Storybook portable-story helpers
    contract-crosscheck/  # Pact ↔ OpenAPI thin wrapper (Milestone 1)
  contracts/              # Zod schemas, OpenAPI generation, XState machines
                          # Shared by production code AND tests
```

Test data is not duplicated across tests. Generators and fixtures are shared. New tests reach for existing generators before writing their own.

**The custom test framework is the Screenplay vocabulary.** Tasks (`castVote`, `enableDonationsForCommunity`, `submitDonation`) are authored once and run in two contexts: against a real running system via `screenplay-system`, or against an isolated component rendered from a Storybook portable story via `screenplay-ct`. The Task source file is identical in both. Only the Ability binding the Actor receives differs. This is the testing-as-architecture lesson, applied to the test code itself.

### Conventions

- **One test file per source file, co-located.** `services/content/src/posts.ts` ↔ `services/content/src/posts.test.ts`.
- **Test names describe the property or invariant, not the function name.** `"voting on a deleted post returns 410 with the deletion problem-details"`, not `"vote() works"`.
- **No conditional logic in tests.** No `if` statements. No `try/catch`. If a test needs branches, it is two tests.
- **No shared mutable state across tests.** Each test gets its own seeded environment.
- **Every test that uses time, IDs, or randomness uses the injected abstractions.** A test that uses `new Date()` directly is a bug.

These conventions are enforced by lint rules, not by review.

## 10. The learning loop

The strategy itself evolves. Each milestone is meant to close with a retrospective: what the techniques caught, what they missed, the cost, what changes next. Through Milestone 12 no standalone retro was written; `docs/retrospectives/` is created the day one lands.

Specific metrics tracked:
- **Layer-by-layer bug counts.** When a bug surfaces, which layer caught it? Which layers should have but didn't?
- **CI time per milestone.** Does adding new layers push total CI time over budget?
- **Flake rates per layer.** Does any layer exceed its budget?
- **Test code size vs production code.** Tracked per milestone via `tokei` (`tokei -e '*.test.ts' -e '*.spec.ts'` vs full repo). No hard ratio target; the metric exists to surface drift over time, not to gate merges.

The strategy is not handed down from on high. It is the current best understanding, expected to be revised as evidence accumulates.

## 11. Explicit exclusions

Techniques deliberately not in v1, with their reasons:

- **Mutation testing of the full codebase.** Stryker runs on the **locked critical-modules list**: voting score logic, flag resolution, donation gating, RFC 7807 envelope construction, `LamportGate`, branded ID parsers, rate-limit token bucket. Adding a module is an ADR; removing requires a retrospective. Full-suite mutation testing is too slow to demonstrate well in a teaching project.
- **Security testing** (SAST, DAST, dependency scanning). Out of scope for the architectural lens.
- **Visual regression testing.** Mentioned in conventions; not enforced as a milestone.
- **Accessibility testing.** Out of scope.
- **Snapshot testing as a default.** Forbidden by convention.
- **Specification-by-example / BDD.** Our MBT serves the same role; a Gherkin layer would be redundant.
- **Differential testing.** Niche; not applicable to QARoom's domain.
- **Performance regression testing at the microbenchmark level.** k6 covers the macro story; microbenchmarks add complexity without distinct philosophy.

These are silent omissions in most projects. In QARoom they are explicit, because saying what we're not doing is itself part of the strategy.

## 12. Service-level objectives (demo-grade)

QARoom is a demo product, not a production service. The SLOs below are *sensible*: they are real enough that load tests have a target, and lax enough that the demo can run on a laptop.

| Endpoint | Latency (p50 / p95 / p99) | Error rate | Availability |
|---|---|---|---|
| `POST /api/communities/{id}/posts` | 50 / 200 / 500 ms | < 0.5% | 99% |
| `GET /api/communities/{id}/feed` | 30 / 100 / 300 ms | < 0.1% | 99% |
| `POST /api/posts/{id}/votes` | 40 / 150 / 400 ms | < 1% | 99% |
| `POST /api/communities/{id}/donations` | 200 / 800 / 2000 ms | < 1% | 99% |
| `GET /system/state` | 20 / 80 / 200 ms | < 0.1% | 99% |
| `GET /system/snapshot` | unbounded | < 1% | best-effort |

These SLOs are introduced in Milestone 0 (skeleton) and exercised by k6 in Milestone 8. Documenting them upfront means every endpoint added in Milestone 1-7 has a performance target it must meet before it lands.

Availability is measured against the local k3d cluster during the demo window, not against a fictional production. Treat the numbers as teaching values: they exist so that "SLO regression" is a defined failure mode in the load-test milestone, not so that QARoom claims production-grade reliability.

## 13. Map back to the architecture

The strategy is the testing side of the architecture's commitment. Where the architecture document says "every service exposes `/system/state`," the strategy explains why: because MBT and snapshot replay both need it.

For navigation back:

| Strategy concern | Architectural commitment that enables it |
|---|---|
| Determinism budget | Commitment 6: Determinism abstractions in every service |
| Observable state | Commitment 7: `/system/state` and `/system/capabilities` per service |
| Scenario replay | Commitment 8: Scoped scenario replay |
| Property-based tenant isolation | Commitment 9: Communities are tenants |
| Model-based testing | Commitment 5: All stateful flows are graphs |
| Trace-based testing | Commitment 12: OpenTelemetry across all services |
| RFC 7807 conformance | Commitment 13: All errors follow RFC 7807 |
| Machine-readable test outputs | Commitment 14: Test outputs are machine-readable |
| Substrate for agent participation | Commitment 15: Substrate is agent-hospitable |

The strategy is what the architecture enables. The architecture is what the strategy demands. They were designed together; the documents reflect that.
