# QARoom: Roadmap

Twelve milestones (M1-M12) atop an M0 foundation (M0-M12), all built; parked follow-up ideas live under "After Milestone 9" below. Each milestone introduces a small, sharply-defined set of testing techniques applied to the architectural boundary where they belong. Each milestone ships a working artifact and at least one ADR. Each milestone has explicit exit criteria so "done" is unambiguous.

Milestones are sized to be demonstrable, not to a fixed schedule. A milestone is done when its exit criteria are met; the elapsed wall-clock time is whatever it is.

## Reading this document

- **Goal**: what the milestone demonstrates and why it exists.
- **Scope (built)**: what code, services, and infrastructure exist by the end of this milestone but not before.
- **Testing techniques introduced**: the techniques whose stories are told by this milestone.
- **Exit criteria**: observable conditions that must hold for the milestone to be considered complete.
- **Risk and mitigation**: what is most likely to overflow the week, and the plan for that.

---

## Milestone 0: Foundations of testability

**Goal.** Establish what a testable service looks like, in one service, with no microservices complexity to distract.

**Scope (built).**
- A single service: `content-service` (posts and votes only; no comments, no communities yet).
- TypeScript, Fastify, Drizzle, Zod, Postgres in Docker Compose (K8s comes in Milestone 3).
- Determinism abstractions: `Clock`, `IdGenerator`, `Randomness` as injectable interfaces.
- Observable state endpoint (`GET /system/state`) with the `as_of: {snapshot_id, lamport, wall_clock}` envelope.
- RFC 7807 Problem Details for all error responses, with the three agent-actionable extensions.
- OpenAPI YAML generated from Zod and committed.
- `oasdiff` configured in CI to gate breaking changes.
- Branded ID parsers (`UserId`, `PostId`, `CommunityId`, ...) via Zod `.brand()` with prefix-refinement.
- AGENTS.md at repo root; CLAUDE.md as a symlink to AGENTS.md.
- `services/content/AGENTS.md` (≤80 lines): first per-service agent reference, sets the template for later services.
- `/.well-known/llms.txt` (removed, ADR-0023).
- `.claude/skills/` directory present (initially with a README explaining the convention).
- `test-results/summary.json` schema with `schema_version: 1` field, extensible `runners[].output: Record<string, unknown>` per-runner payload, and `runners[].seeds: Record<string, unknown>` for property-test seeds and fuzzing seeds. Envelope frozen; per-runner payload extensible.
- `LamportGate` primitive in `packages/contracts/lamport.ts`: all mutating paths funnel through it.
- **Domain generators** in `packages/testing-utils/generators/` for `Post`, `Vote`, `IdempotencyKey`, `ProblemDetails`. Later milestones add their own.
- **Custom matchers** in `packages/testing-utils/matchers/`: `expectRFC7807`, `expectLamportAdvanced`. State-machine + span matchers ship later milestones.
- **Canonical test harness** in `packages/testing-utils/harness/`: `setupServiceTest()` returns `{db, clock, ids, randomness, request}` with per-test isolation (fresh schema, seeded clock, deterministic IDs). Example wiring documented in `services/content/tests/README.md`.
- `/system/capabilities` MCP-shape validation: a CI test loads the endpoint output and validates against the MCP tool JSON Schema.
- fast-check seed reporting via custom Vitest reporter: failure output includes seed; replay via `VITEST_SEED=<n> pnpm test`.
- SLO baseline document at `docs/slos.md` (mirrors and points to Doc 03 §12).
- Custom Biome (or ESLint sidecar) rule enforcing test-name format (no `vote() works` style; names must describe the property/invariant).
- Zod ↔ OpenAPI round-trip property test: any Zod schema -> OpenAPI -> schema-validate sample payloads -> must accept/reject identically to direct Zod parse. Catches generator gaps.

**Milestone 0 spikes** (1 day each, run in parallel before scope work begins). If a spike fails, the corresponding later-milestone technique is dropped or replaced:

- **EvoMaster v3 against TS Fastify.** Verify EvoMaster can drive a Fastify service from its OpenAPI and emit usable test output. If it cannot, Milestone 8 drops EvoMaster and substitutes Schemathesis stateful-links.
- **Schemathesis stateful workflows on the example service.** Verify `--stateful=links` produces meaningful sequences against a real OAS (requires OAS `links` declared, see Doc 05 OpenAPI conventions).
- **Pact ↔ OpenAPI cross-check.** Spike the thin `@apidevtools/swagger-parser`-based wrapper used in Milestone 1.
- **Microcks-async WS binding.** Verify Microcks-async serves a sample WebSocket AsyncAPI mock with Playwright-readable behavior. If it fails, Milestone 5 falls back to a handrolled WS mock via `mock-socket`.
- **AsyncAPI drift gate.** Evaluate `@asyncapi/diff` for breaking-change detection on a sample async contract. If it lacks semantic-diff fidelity, ship a thin custom diff in `packages/testing-utils/async-diff/` matching the OAS-diff philosophy.
- **Test-name Biome rule.** Author the rule and run against a sample test file with mixed names; verify low false-positive rate. If false positives are unmanageable, downgrade to lint-warning and rely on review.

**Testing techniques introduced.**
- Unit testing (Vitest)
- Property-based testing (fast-check), e.g., "post creation is idempotent given the same Idempotency-Key"
- Schema validation (Zod runtime + OpenAPI + oasdiff)
- Lint rules enforcing the determinism abstractions and the test-name convention

**Exit criteria.**
- `pnpm test` runs and all four test types pass.
- A deliberately introduced direct `new Date()` call in business code is caught by lint.
- A deliberately introduced breaking schema change is caught by oasdiff in CI.
- A `/system/capabilities` response that omits a registered operation fails the MCP-shape test.
- The committed OpenAPI matches what Zod generates (verified in CI by the round-trip test).
- AGENTS.md (repo root) ≤ 200 lines; `services/content/AGENTS.md` ≤ 80 lines.
- A property-test failure reports its seed inside `test-results/summary.json`; replaying the seed reproduces the failure.
- `test-results/summary.json` is produced by CI and validates against its schema (carries `schema_version: 1`).
- The six Milestone 0 spikes have either confirmed feasibility or produced an ADR amending the affected later milestone.

**Risk and mitigation.** Risk is over-engineering Milestone 0 because the agent-substrate adds new artifacts. Mitigation: scope the substrate (AGENTS.md, llms.txt, summary.json schema) to the minimum that satisfies exit criteria; if it grows, defer non-blocking additions to Milestone 1.

---

## Milestone 1: The first boundary

**Goal.** Introduce a service boundary and demonstrate two complementary API-testing philosophies in conversation with each other. Also: the trust-boundary milestone introduces rate limiting and its failure-domain testing.

**Scope (built).**
- Add `gateway` service. The gateway calls content-service for posts.
- Pact v4 REST contract tests: consumer in gateway, provider verification in content-service.
- Schemathesis fuzzing the gateway against its OpenAPI spec (containerized; no Python in the monorepo).
- Pact ↔ OpenAPI cross-check test (custom Vitest wrapper, see ADR-0003).
- **Rate limiting at the gateway**: per-IP and per-authenticated-principal token bucket via a Fastify plugin (in-memory in Milestone 1, swappable for Redis in a later milestone if needed). Exceeded limits return RFC 7807 Problem Details with `failure_domain: "rate_limit"`, `retryable: true`, and `next_actions: [{verb:"GET", href:"/system/limits", description:"Inspect your current usage"}]`.
- `GET /system/limits` introspection endpoint on the gateway (per-principal current usage and reset time).
- **Pact provider verification** runs against a Testcontainers-booted content-service with a real Postgres container (`@pact-foundation/pact` provider verifier). Document the pattern; later providers reuse it.
- **Pact discovery**: `pnpm pact:verify --provider <name>` scans `services/*/pacts/` for files referencing the named provider. No external broker; the monorepo is the broker. This is an intentional teaching point.

**Testing techniques introduced.**
- Consumer-driven contract testing (Pact)
- Schema-driven API property exploration (Schemathesis)
- Triangulation across spec, code, contract, runtime
- Property tests on the rate limiter: under any sequence of N requests at rate R, the number that succeed never exceeds the bucket capacity; the 429 response always carries the documented `failure_domain` and `retry-after`.

**Exit criteria.**
- A deliberately bad contract change in the consumer causes the provider verification to fail.
- A deliberately bad schema change is caught by Schemathesis (server returns 500 on a generated input).
- The Pact ↔ OpenAPI cross-check fails when a Pact interaction references an OAS operation that does not exist or violates the OAS request/response schema.
- A property test catches a regression where the rate limiter under-counts (allows more than capacity) or returns the wrong `failure_domain`.
- What each of the two tools catches that the other does not is named explicitly.

**Risk and mitigation.** Risk: Pact ↔ OpenAPI cross-check has no first-class OSS tool (PactFlow's BDCT is SaaS-only). Mitigation: ship a thin custom check in `packages/testing-utils/contract-crosscheck/` that loads OAS via `@apidevtools/swagger-parser`, parses Pact JSON, and asserts each Pact interaction is a subset of an OAS operation. Limit acknowledged: validates Pact->OAS direction only; OAS->Pact gaps are caught by Schemathesis instead.

---

## Milestone 2: Multi-tenancy as a property

**Goal.** Introduce communities as the tenancy boundary. Demonstrate that isolation is a *property*, not a feature, and is best tested as one. Introduce the identity boundary and prove that JWT issuance itself is a tested surface.

**Scope (built).**
- Add `identity-service` (users, sessions, JWT, community membership, JWKS endpoint).
- JWT signing-key model: per-environment keypair with `kid` header; rotation supported via a `JWKS` endpoint that lists current + previous public keys.
- Communities as tenants; posts now belong to a community via `community_id`.
- Backfill existing posts into a default "general" community.
- The backfill migration is itself a small state machine (XState, first taste).
- Property-based tests: for any sequence of operations across two communities, no read returns data from the other community.
- JWT property tests: issuance, validation, kid-not-found rejection, expired-token rejection, rotation continuity (old kid still validates within grace window).
- Pact contract test for `GET /jwks.json` (gateway consumer, identity provider).

**Testing techniques introduced.**
- Tenant isolation as a property-based invariant (fast-check)
- Database migration testing as a state-machine-driven discipline
- First introduction of XState (in service of the migration model)
- JWT issuance as a tested surface (property + contract)

**Exit criteria.**
- A property test that, when isolation is broken deliberately, finds the leak in under 5 seconds.
- The migration is reproducible: tear down, re-migrate, identical end state.
- A test verifies the migration is fully reversible.
- A property test fails when JWT validation accepts an expired token, a wrong-kid token, or a token signed by a key not in JWKS.
- A simulated key rotation (issue new key, mark old key prior) continues to validate tokens issued under the old key until the grace window expires. **Grace window is 24h in production config and 1h in test config.**
- A deliberately broken migration (e.g., `up` without matching `down`) fails the migration idempotency test.
- All Milestone 0 rows backfilled with `community_id = comm_general` parse successfully through `CommunityId.parse()`.
- ADR: "Communities-as-tenants and the shared-schema discriminator pattern."
- ADR: "JWT signing-key model and rotation contract."

**Risk and mitigation.** Risk is overscoping the migration story (we said earlier we'd defer it). Mitigation: keep the migration to a single forward step: adding the `community_id` column and backfilling. The full migration narrative is a future series.

---

## Milestone 3: Going to Kubernetes (and proving nothing broke)

**Goal.** Migrate from Docker Compose to k3d + Tilt + Helm. The migration *itself* is the demonstration: existing tests catch any regression introduced by the move. Bring OpenTelemetry online with it because Milestone 4's async work demands it.

**Scope (built).**
- k3d cluster for local; KinD for CI.
- Tilt as the inner-loop development tool.
- Helm chart per service.
- OpenTelemetry SDK in every service.
- Manual trace propagation primitives (the seed of the `@qaroom/messaging` SDK that Milestone 4 expands).
- Jaeger for trace visualization.
- Prometheus + Grafana for metrics (minimal, just enough to demonstrate).
- `tenant.id` attribute on every span.
- GenAI semantic conventions opted in (`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`) even though no LLM calls yet: sets the precedent.

**Testing techniques introduced.**
- Migration as a tested transformation (no new test types; demonstration of using existing types to verify a big change)
- Distributed tracing as a debugging aid (testing-as-a-surface comes in Milestone 4)

**Exit criteria.**
- `tilt up` brings the system up locally in under 2 minutes.
- All tests from previous milestones still pass.
- A deliberately broken Helm value (e.g., wrong service port) fails the smoke test that asserts `/health` returns 200 on every service after `tilt up`.
- Traces are visible in Jaeger for the main flows.
- Every span carries `tenant.id`; a span missing the attribute fails a CI check that scans recent traces.
- ADR: "Why Kubernetes, and how we keep dev fast."

**Risk and mitigation.** Risk: Helm chart authoring per service consumes more time than expected. Mitigation: a single `qaroom-service` Helm chart template authored before Milestone 0 begins, reused across all services. This is one of the small upfront investments worth making.

---

## Milestone 4: Async messaging and the second contract philosophy

**Goal.** Introduce message-based communication for state changes. Demonstrate that contract testing applies to async messages with the same rigor as REST, with new failure modes that REST doesn't have. Land the full dedup discipline (Commitment 17) so duplicate delivery cannot produce double-effects.

**Scope (built).**
- NATS JetStream deployed via Helm. Streams configured with `duplicate_window: 5m`.
- Some interactions move to async: posts emit events, votes emit events, comments emit events.
- The `@qaroom/messaging` shared SDK:
  - Publish/subscribe wrappers that inject and extract OpenTelemetry trace context through NATS headers.
  - Publisher sets `Nats-Msg-Id` from the injected `IdGenerator` on every emit.
  - Transactional-outbox helper: `outbox.publish(tx, event)` writes the event row in the same Postgres transaction as the business write; a per-service relay process drains the outbox to JetStream and retries on failure until ack.
  - Consumer helper: `subscribe(handler, { subscriptionName })` wraps the handler with `processed_events` dedup. The handler's effects + the `processed_events` insert run in a single Postgres transaction; second delivery of the same `event_id` is skipped.
  - Reusable Drizzle migration fragments for `outbox`, `processed_events`, and `idempotency_responses` (housed in `@qaroom/messaging/migrations/`); every service that adopts messaging applies the fragment via its own Drizzle migration pipeline.
- AsyncAPI YAML generated from Zod and committed per service; drift gated by the tool selected in Milestone 0 spike.
- Event schema versioning: `packages/contracts/events/<name>.v{N}.ts` frozen at release boundaries, with a consumer-compat test.
- NATS subject naming convention enforced (see Doc 05 §3).
- Pact v4 message contract tests for the new async flows; Pact also asserts publisher sets `Nats-Msg-Id`.
- `Idempotency-Key` middleware on all HTTP mutations, backed by the `idempotency_responses` table.
- **TTL/GC for dedup tables.** Scheduled job (`pnpm jobs:gc-dedup`) deletes `idempotency_responses` and `processed_events` rows older than 24h. Runs hourly in dev, daily in CI smoke. Convention: do not rely on it for correctness: `Nats-Msg-Id` window + handler idempotency are the contract; GC is hygiene.
- **NATS subject literal lint rule** (`qaroom/no-raw-nats-subject`): bans string literals matching `qaroom\.` outside `packages/contracts/subjects.ts`. Devs must use the builders.
- **Async-fuzz portfolio gap, explicit.** Schemathesis is REST-only. AsyncAPI stateful fuzzing has no mature OSS tool. The async story stops at contract + dedup + drift; the gap is named as intellectual honesty rather than papered over with a half-tool.
- Single-writer-per-resource enforcement at the persistence layer: `pg_advisory_xact_lock(hashtextextended(resource_id, 0))` + `SELECT … FOR UPDATE` on the resource row.
- Tracetest comes online with assertions on the cross-service async flows. **Tracetest assertions run in PR full (<25min) and merge-to-main loops, not PR fast**: Tracetest infra (collector + assertion service in cluster) does not fit the <10min fast budget.

**Testing techniques introduced.**
- Message contract testing (Pact v4 async)
- Async dedup as a property: fast-check fires duplicate `Nats-Msg-Id` deliveries and asserts no observable double-effect on any consumer
- Idempotency-Key replay test: identical key returns identical response without re-executing
- Single-writer property: concurrent mutations on the same resource serialize correctly under advisory + row locks
- Trace-based testing (Tracetest): the observability boundary becomes a testing surface
- Cross-async tracing
- Async schema drift detection (AsyncAPI diff)

**Exit criteria.**
- A consumer that misinterprets a message shape fails in contract verification, not at runtime.
- The trace view in Jaeger shows a flow that spans sync HTTP and async messaging coherently.
- A Tracetest assertion fails when a service makes an unexpected downstream call.
- A duplicate-delivery property test catches a regression where a consumer handler is not idempotent (e.g., the developer removes the `processed_events` insert).
- A breaking AsyncAPI change is caught by CI before merge.
- ADR: "Sync vs async: where each lives and why; the OTel propagation contract."
- ADR: "Async dedup: outbox, Msg-Id, and processed_events."

**Risk and mitigation.** Risk: trace context propagation through NATS is fiddly and there's no official OTel auto-instrumentation. Mitigation: the `@qaroom/messaging` SDK is the single point of investment; every service uses it; the contract test in Pact asserts the trace context is present in the metadata.

---

## Milestone 5: Feature gating as a state machine

**Goal.** The core demonstration of the project. Introduce the donations feature with a gradual per-community rollout, model the rollout as an XState machine, and use Playwright + `@xstate/graph` to do model-based testing across the whole system.

**Scope (built).**
- `flags-service` (per-community flag resolution).
- `donations-service` (donation transactions; integrates with the mocked payment provider).
- The donation rollout state machine (**XState 5**, hand-authored, in `packages/contracts`). Every transition emits an `xstate.transition` OTel span: substrate for reverse-conformance assertions in CI. The machine that `@xstate/graph` traverses is a **flattened, context-free projection** of the rollout machine: `@xstate/graph` 3 hard-rejects `invoke`, `after`, and delayed actions ("Invocations on test machines are not supported"), and any `context` explodes the BFS, so async/timer boundaries are modeled as explicit events and per-actor data lives in isolated sub-machines unit-tested separately. A regression test pins the constraint (an `invoke` machine must throw; the flattened one must traverse).
- A **React + Vite** web frontend (`services/web`) built on a real **atomic-design** library: `atoms/ -> molecules/ -> organisms/ -> templates/ -> pages/`, each tier importing only tiers below it. Folder-per-component (`Component.tsx` + one-line `index.ts` barrel + `Component.stories.tsx` + `Component.ct.tsx`), `forwardRef` + `displayName`, styled exclusively through **semantic design tokens**: `--color-*` CSS variables in `styles/globals.css` (dark on `:root`, light flipped under `.light`), surfaced as **Tailwind 4** utilities via the CSS-first `@theme` block (no `tailwind.config.js`). A thin `ThemeProvider` toggles `.light` only and holds no styles. This is a real component library, not a placeholder: it is the substrate the Milestone 8 component tests exercise.
- WebSocket push for donation-state and notification events, with a polling fallback (Commitment 11). AsyncAPI schema for the WS protocol committed; drift gated by the AsyncAPI diff tool chosen in Milestone 0.
- **WS authentication via short-lived ticket.** Client `POST /ws/tickets` (authenticated with JWT) returns a one-time, 30-second `ticket` string stored in identity-service Redis (or in-memory Milestone 5; Redis later). Client opens WS with `Sec-WebSocket-Protocol: ticket.<ticket>`; gateway validates and consumes the ticket before upgrade. Invalid, expired, or replayed tickets fail handshake with 401 RFC 7807. The pattern is chosen over bearer-in-subprotocol because subprotocol headers leak into proxy/server access logs; ticket leak window is ≤30s and one-use. Test: replayed ticket rejected; expired ticket rejected; tampered JWT on `POST /ws/tickets` rejected.
- Microcks-async mock for the WS schema; Playwright assertions verify the UI under both WS and polling paths.
- Parity test: every WS event delivered must also be retrievable via the polling endpoint.
- **Screenplay foundation** (`packages/testing-utils/screenplay/`). Shared Actors, Abilities, Tasks, and Questions over Playwright. The load-bearing design is a single **`PageProvider.getPage()` seam**: `BrowseTheWeb` (wraps a full `Page`) and the Milestone-8 `InteractWithComponent` (wraps a CT mount) both implement it, so every Action/Question touches the browser through `actor.withPageProvider().getPage()` and runs unchanged in E2E or CT. **High-level Tasks must route through `withPageProvider()`, never a concrete ability**: calling `BrowseTheWeb` directly makes a Task E2E-bound and silently breaks the Milestone 8 "same Task, two contexts" promise. Also ships `CallTheApi` and `ConsumeTheStream`. Introduced now because the system-test side needs it first; reused verbatim by Milestone 8 component tests.
- System tests in `services/web/tests/e2e/` are authored as Screenplay flows whose paths are *generated from the XState model* via `createTestModel(rolloutModel).getShortestPaths({ allowDuplicatePaths: true, serializeState: s => JSON.stringify(s.value) })` for PR CI and `.getSimplePaths(...)` for nightly. `allowDuplicatePaths` is load-bearing: the default dedup drops prefix paths and silently shrinks coverage; the value-only `serializeState` keeps the context-free model from multiplying states. Each path becomes a sequence of Screenplay Tasks performed by an Actor. (`getShortestPathPlans`/`getSimplePathPlans` are the removed XState-v4 API; do not use them.)
- Microcks deployed to mock the payment provider from its OpenAPI spec.
- The model-validation test: a single test that runs at the start of any MBT suite and asserts the system's reported initial state matches the model's initial state and every modeled event has a corresponding system endpoint.
- Tracetest assertion: for every observed `xstate.transition` span, `from`, `to`, and `event` are members of the model's transition graph (reverse conformance). **`xstate.transition` spans are always-sampled** (sampling decision flag set per-span in the instrumentation wrapper) so head-based sampling never drops them. Tail-based sampling can be added later without changing the assertion.
- **`LamportGate` snapshot atomicity.** `GET /system/snapshot` acquires the gate (no concurrent writes proceed) for the duration of the read, then releases. Snapshot is a consistent view across DB-backed and in-memory models.
- **MBT path bounds** at `MAX_DEPTH=10` in PR CI; nightly bound `MAX_DEPTH=20`. The generator also asserts a path-count *floor* (not just an upper cap): a model that shrinks below the expected reachable-state count fails CI, so a regression that erases states can't pass silently. Bounds raised later when concrete examples justify.
- **Stack (pinned, verified 2026-05):** `xstate@5.32`, `@xstate/graph@3.0.4` (pinned exact: the invoke/`after` rejection and traversal options are undocumented internals a minor bump could change), `@xstate/react@6.1`, React + Vite, `tailwindcss@4.3` + `@tailwindcss/vite@4.3`, `@playwright/test@1.60`. Test data uses **fast-check** generators (the repo standard), not a separate factory library.
- **State-machine custom matchers** ship: `expectStateMachineAt(actor, state)`, `expectTransitionEmitted(span, {from, to, event})`.
- **WS test matchers** ship: `expectWsEventMatchesPolling(window)`.

**Testing techniques introduced.**
- Model-based testing (XState + `@xstate/graph` + Playwright + Screenplay)
- Screenplay pattern as the shared test-authoring discipline (Actors, Abilities, Tasks, Questions): same primitives later reused by component tests in Milestone 8
- Reverse conformance via OTel transition spans + Tracetest
- Service virtualization (Microcks; Microcks-async for WS)
- The model-validation test (conformance between model and system)
- WebSocket contract testing (AsyncAPI + Microcks-async + WS-vs-polling parity)

**Exit criteria.**
- A deliberately broken transition in donations-service causes exactly one MBT-generated path to fail, and the failure output points to the exact state where the divergence happened.
- A deliberately introduced *off-model* transition (the code emits a state name not in the XState model) is caught by the Tracetest reverse-conformance assertion.
- The state machine is rendered (Stately Studio or similar) and the visualization is in the README.
- Microcks serves the payment provider mock; donations-service tests use it transparently.
- The WS endpoint and the polling endpoint return the same events for the same window (parity test passes).
- The web frontend's atomic structure is documented in `services/web/docs/atomic-structure.md`.

**Risk and mitigation.** XState + Playwright MBT is in the author's wheelhouse, so the risk here is lower than it would otherwise be. Remaining risk: the breadth of services touched (flags, donations, web, Microcks). Mitigation: the state machine and tests are the core deliverable; the web UI can be intentionally bare; Microcks setup is well-documented.

---

## Milestone 6: Chaos engineering

**Goal.** Introduce Chaos Mesh and demonstrate that the system, designed for testability, holds up under realistic failure modes. Each chaos experiment is paired with an assertion about documented failure behavior.

**Scope (built).**
- Chaos Mesh installed in the cluster (with the k3s containerd socket override).
- LitmusChaos installed alongside for HTTP-level chaos (Chaos Mesh's HTTPChaos is unreliable on k3d's flannel CNI).
- 7 specific experiments as committed YAML files:
  1. PodChaos: donations-service unreachable mid-rollout
  2. NetworkChaos: slow NATS broker
  3. NetworkChaos: dropped messages between content-service and consumers
  4. StressChaos: Postgres connection pool exhaustion
  5. TimeChaos: clock skew between services
  6. Litmus HTTPChaos: gateway returns 500 for donations endpoint
  7. NetworkChaos: partition between gateway and donations-service
- Each experiment has a documented "expected behavior" assertion that the chaos test verifies.
- **Each experiment ships its own deliberate-bug demo**: remove the documented mitigation (circuit breaker, retry, fallback, dedup, timeout, queue backpressure, partition tolerance) -> the matching chaos assertion fails -> restore mitigation -> green.
- A "failure modes document" (`docs/failure-modes.md`) compiled from these.

**Testing techniques introduced.**
- Chaos engineering with hypothesis (Chaos Mesh + Litmus)
- Failure-modes-as-spec discipline

**Exit criteria.**
- Each chaos experiment is paired with an assertion that holds when the system is healthy and *also* holds during the chaos.
- Each of the 7 experiments has its own deliberate-mitigation-removal demo recorded.
- ADR: "Chaos as a property check, not a stunt; why Chaos Mesh and Litmus together."

**Risk and mitigation.** Risk: HTTPChaos on k3d is documented as broken with flannel CNI. Mitigation: Litmus pre-installed and used for HTTP chaos from the start; no surprise discovery mid-milestone. Risk: `TimeChaos` requires `SYS_TIME` and `SYS_BOOT` capabilities, which k3d does not grant by default. Mitigation: the k3d cluster config grants both caps to the chaos namespace via the `--k3s-arg "--kubelet-arg=allowed-unsafe-sysctls=*"` flag and a privileged `chaos-daemon` DaemonSet; the cluster bootstrap script (`scripts/bootstrap-k3d.sh`, added in Milestone 3) sets this up so Milestone 6 inherits a chaos-ready cluster. Every chaos experiment YAML is captured into the snapshot artifact (Commitment 6), making the chaos run replayable from the manifest alone.

---

## Milestone 7: Scoped scenario replay

**Goal.** Build the scenario capture and replay system. Scoped per the architecture: database state + observable state + clock seed only. Documented limits are part of the deliverable, not a footnote.

**Scope (built).**
- `/system/snapshot` endpoints on each service (GET captures, POST restores).
- The `qaroom-replay` CLI: captures snapshots from all services in parallel, bundles into a tarball; reverse operation loads into Docker Compose with seeded data.
- **Bundle format**, versioned. Zod schema `SnapshotBundleV1` in `packages/contracts/snapshot.ts`. Tarball contains `manifest.json` (`{schema_version: 1, created_at, services: [{name, snapshot_file, lamport, clock_seed}], chaos_manifests: [...]}`), one `<service>.snapshot.json` per service, and any active chaos manifests captured verbatim. Restore validates against `SnapshotBundleV1`; mismatched `schema_version` refuses to load. Future `SnapshotBundleV2` ships alongside, never replaces.
- Frontend "Capture for replay" button (dev mode only) that invokes the CLI's capture flow.
- Regression catalog: scenarios captured from previous milestones' deliberate-bug demonstrations become regression tests.
- Documented limits: no in-flight HTTP, no JetStream stream restore, no WebSocket session state.

**Testing techniques introduced.**
- Snapshot-based reproducibility ("DST-inspired" debugging)
- Regression-by-scenario discipline

**Exit criteria.**
- A deliberately introduced bug from a previous milestone is captured into a snapshot, the snapshot is replayed in a fresh env, and the bug reproduces with identical observable behavior (same `as_of.lamport`, same response body, same error).
- After fixing the bug, replaying the same snapshot against the fixed code shows green.
- A demo bug captured in one environment can be reproduced locally in under 30 seconds end-to-end.
- A captured scenario from CI can be loaded locally and reproduces the failure.
- At least three regression scenarios from previous milestones are in the catalog and run on every PR.
- ADR: "Scenarios as first-class testing artifacts; the limits of replay without a hypervisor."

**Risk and mitigation.** Risk: the scope is ambitious. Mitigation: the minimum deliverable is "one scenario captured, one scenario replayed, documented limits." Over-deliver opportunistically.

---

## Milestone 8: Load, mutation, search-based fuzzing, and component testing

**Goal.** Round out the portfolio with the techniques that verify the tests themselves and find what the tests don't. Introduce Storybook-driven component testing for the web frontend.

**Scope (built).**
- k6 load tests against the SLOs documented in `docs/03-testing-strategy.md` §12. Focused experiments on the two highest-traffic endpoints (vote casting write-heavy, feed retrieval read-heavy) plus the donation flow.
- Stryker mutation testing on the **critical-modules list** (locked in Doc 03 §11): voting score logic, flag resolution, donation gating, RFC 7807 envelope construction, `LamportGate`, branded ID parsers, rate-limit token bucket. Adding a module to the list is an ADR; removing requires a retrospective.
- EvoMaster v3 (if Milestone 0 spike confirmed feasibility) as a nightly job: outputs test files into `services/<name>/tests/evomaster-generated/` for review and selective commit. If the spike failed, Schemathesis stateful-links runs nightly instead and EvoMaster is dropped.
- **Storybook + Playwright CT + Screenplay** for the web frontend. Every atomic-design component (atoms/molecules/organisms) has a story. Stories are consumed two ways:
  - **As the visual showcase + interaction tests**: **Storybook 10** (`@storybook/react-vite`) with `play()` functions (importing `expect`/`userEvent` from `storybook/test`, the consolidated subpath, *not* `@storybook/test`) that run **headlessly in CI via `@storybook/addon-vitest`** (the portable-stories Vitest runner that supersedes the legacy test-runner), with `@storybook/addon-a11y` checks in the same run.
  - **As Playwright Component Tests.** `composeStories` (from `@storybook/react-vite`) is used to *read* each story's composed `args`/decorators, but the CT **mounts the raw component spread with `story.args`**: a `composeStories()` result cannot be `mount()`-ed in Playwright CT ("Component cannot be mounted", the Node↔browser bundling split). This is the single most important CT pattern; lint forbids the anti-pattern. Each CT mounts in real Chromium, awaits `document.fonts.ready`, then asserts via `toHaveScreenshot` (visual) and/or Screenplay Tasks. Component and system tests share one Screenplay vocabulary; only the Ability binding differs: CT actors get `InteractWithComponent` (wrapping the CT mount), system actors `BrowseTheWeb`, both behind the Milestone-5 `PageProvider.getPage()` seam, so the **same Task source file** runs in both suites.
  - **Unified coverage:** component-test coverage (Playwright CT instrumented with `vite-plugin-istanbul`, Istanbul) and unit/property coverage (Vitest, V8) are reconciled into one report with `monocart-coverage-reports` (a plain `nyc merge` cannot mix V8 + Istanbul), feeding the same `test-results/summary.json` discipline.
  - The custom framework lives in `packages/testing-utils/screenplay/` (Milestone 5) + `packages/testing-utils/screenplay-ct/` (this milestone). The framework is the headline deliverable: Storybook and Playwright CT are means, not ends. **Stack (pinned, verified 2026-05):** `storybook@10.4` + `@storybook/addon-vitest@10.4` + `@storybook/addon-a11y@10.4`, `@playwright/experimental-ct-react@1.60` (still "experimental", locked to the exact `@playwright/test` version), `vitest@4.1` (v4 splits suites via `projects`, not the removed `workspace`; re-baseline the coverage gate: V8 remap changed), `monocart-coverage-reports@2.12`, `@axe-core/playwright@4.11`.

**Testing techniques introduced.**
- Load testing against documented SLOs (k6)
- Mutation testing (Stryker)
- Search-based fuzzing (EvoMaster v3), conditional on Milestone 0 spike
- Component testing as Screenplay Tasks against Storybook portable stories (Playwright CT)
- The custom framework: one Screenplay vocabulary, two Ability bindings (CT and system), shared across component and end-to-end tests

**Exit criteria.**
- A load test fails when an SLO is missed (verified by deliberately introducing a slow path).
- Mutation testing surfaces at least one surviving mutant that leads to a real test improvement.
- EvoMaster generates at least one test case covering an edge case not previously tested, and the case is committed to the regression catalog. (Or: Schemathesis stateful-links covers an analogous case if EvoMaster was dropped.)
- Every web component has a Storybook story; a deliberately broken atom (e.g., a button that no longer dispatches its click) is caught by the component-level Screenplay Task asserting the expected Question.
- A Screenplay Task authored once (e.g., `castVote(post)`) is provably executable in both contexts: as a system test via the system Ability binding, and as a component test via the CT Ability binding. The same Task source file appears in both test suites (proving the `PageProvider` seam holds: the Task touches the browser only through `withPageProvider()`).
- Component tests mount the raw component spread with `story.args` (reading `args` via `composeStories`); a lint rule flags any attempt to `mount()` a `composeStories()` result, which fails at runtime.
- ADR: "Testing your tests: when to invest in mutation testing and search-based fuzzing."
- The frontend testing stack (portable stories + Playwright CT + Screenplay + XState MBT, one vocabulary two contexts) is recorded in [ADR-0005](adr/0005-frontend-testing-stack.md).

**Risk and mitigation.** Risk: EvoMaster v3 against TS Fastify is unverified. Mitigation: the compatibility spike is moved to Milestone 0 (see Milestone 0 spikes); if the spike fails, EvoMaster is dropped from Milestone 8 and the technique is replaced by a deeper Schemathesis stateful-links story. Note: EvoMaster-generated files commonly exceed 500 lines; they ship with the `// @generated` marker (Doc 05) and are exempt from the line-limit lint. The baseline limit itself is a starting point and may be raised when concrete examples justify.

---

## Milestone 9: The agentic moderator

**Goal.** Demonstrate that the architecture welcomes LLM agents as first-class actors. Introduce a Python LangGraph-based community moderator service that subscribes to NATS events, builds a retrievable knowledge base, and proposes moderation actions. Apply the testing techniques specific to LLM-integrated systems.

**Scope (built).**
- `moderator-agent` service (Python; FastAPI; LangGraph for the agent workflow).
- Vector store via pgvector in a dedicated Postgres instance.
- Structured outputs only: every LLM response validated against Pydantic schemas (mirrors the TS Zod shape).
- The agent's workflow modeled as a LangGraph state machine, with the same `/system/state` and conformance-test contract as every other service.
- LLM provider: **OpenAI**. Models pinned in config (`gpt-*` family, exact ID locked in the Milestone 9 ADR). `temperature=0`, `seed` parameter set, `response_format={type: json_schema}` for structured outputs. Cost guard: per-eval-run budget cap; CI eval pre-flight estimates token cost and fails if it exceeds the cap.
- Promptfoo eval harness with a golden set of moderation scenarios; OpenAI as the provider.
- Metamorphic tests: the agent's moderation decision is invariant under benign paraphrase. **Deliberate-bug demo:** introduce a prompt regression sensitive to one specific phrasing: metamorphic test catches it; non-metamorphic Promptfoo eval misses it.
- **Python NATS dedup story.** The moderator subscribes to NATS but does not own a `@qaroom/messaging` Python sibling. Instead, idempotency is delegated to **LangGraph's checkpointer** (per-thread state, replay-safe). The asymmetry vs TS services is documented in the Milestone 9 ADR as a deliberate scope choice: replicating the full TS dedup machinery in Python costs more than it teaches.
- OpenTelemetry GenAI semantic conventions on every LLM call.

**Testing techniques introduced.**
- LLM evaluation harnesses (Promptfoo)
- Metamorphic testing for stochastic systems
- Structured output validation as a contract for AI
- LangGraph state-machine conformance (same playbook as XState)

**Exit criteria.**
- The agent's workflow is rendered as a state graph in the README.
- Promptfoo evals run in CI on prompt or model changes.
- A deliberately introduced regression in the moderation prompt fails an eval.
- A paraphrase of a known-good input still produces the same moderation decision.
- ADR: "Testing AI-integrated systems: the techniques that don't fit the traditional pyramid."

**Risk and mitigation.** Risk: this is genuinely the most complex milestone and the most novel territory. Mitigation: scope reductions if needed: the agent only needs to demonstrate one workflow (auto-flag posts that violate documented community rules), not be a full moderator.

---

## After Milestone 9

Milestones 10-12 all shipped: the tested MCP server (M10, ADR-0006), the webhooks delivery edge (M11, ADR-0019), and the retrieval-grounded moderator v2 (M12, ADR-0020). Anything beyond is parked: ideas on the shelf, not scheduled work.

- **Milestone 10: The tested MCP server, and the agentic CI/CD demonstration.** Two movements. (1) A single **cross-service MCP server** (`packages/qaroom-mcp`) realizing the `/system/capabilities` seam as a *first-class tested service*: tool manifest drift-gated by the same Zod->OpenAPI->`oasdiff` pipeline as the services, RFC 7807 tool errors, determinism-trio golden transcripts, and property/metamorphic tool I/O. Read-first surface (capabilities proxy, state/limits/test-results resources, conventions oracle); mutating tools a second pass. The four gates and rejected alternatives are recorded in [ADR-0006](adr/0006-mcp-as-tested-service.md). (2) 10 parallel Claude Code subagents working on goals, each in its own ephemeral namespace, consuming that tested tool surface and the frozen `test-results/summary.json` schema as substrate. **Built**: [ADR-0006](adr/0006-mcp-as-tested-service.md); movement 2 documented in `docs/agentic-ci-demo.md`.
- **Milestone 11: Webhooks** with their unique testing problems (delivery guarantees, retry contracts). **Built**: full spec below; [ADR-0019](adr/0019-webhooks-as-a-tested-delivery-edge.md).
- **Milestone 12: Moderator v2, retrieval-grounded RAG + the eval / red-team stack.** Re-scope the Milestone 9 moderator from a prompt-baked classifier into a genuine retrieval-grounded agent (policy corpus, citation-bearing verdict, precedent consistency, abstain/escalate) and realign LLM testing: **DeepEval** (RAG + agentic + custom metrics), **DeepTeam** (OWASP red-team), **Promptfoo dropped** (OpenAI-acquired, March 2026). RAGAS demonstrated via DeepEval's wrapper, not adopted as a separate framework. **Built**: full spec below; [ADR-0020](adr/0020-moderator-rag-and-eval-stack.md).
- **Milestone 13: Real edge credentials**: supersede ADR-0022; signup/login, JWT enforcement at the gateway, rate limiting keyed on authenticated identity. **Deferred**: decided 2026-06-12, not scheduled.
- **Milestone 14: Continuous testing in production**: feature flags as the canary substrate. **Deferred**: parked, not currently planned.
- **Milestone 15: Visual regression and accessibility testing**: for the frontend. **Deferred**: parked, not currently planned.

---

## Milestone 11: Webhooks

Post-v1, additive. The architecture left a "designed-for-later" seam for webhooks
(docs/02-architecture.md); this milestone realizes it. No superseding ADR for ADR-0001 is needed:
webhooks consume the existing event seam and add no new commitment ([ADR-0019](adr/0019-webhooks-as-a-tested-delivery-edge.md)).

**Goal.** Build the outbound-delivery edge (QARoom's five domain events delivered to external
subscribers) and demonstrate the testing techniques unique to delivery systems: **at-least-once
delivery guarantees** and the **retry/backoff contract**, the two problems the roadmap named.

**Scope (built).**
- `services/webhooks` (TypeScript, service-kit, port 8087): a pure consumer of all five NATS channels
  that delivers to external https endpoints. Publishes nothing (recursion guard).
- Subscription CRUD (tenant-scoped, **gateway-proxied** per ADR-0019): create (write-once HMAC
  secret), list, get, delete, pause/resume, and a read-only **delivery ledger** that makes the retry
  contract observable.
- Delivery engine: a durable fan-out consumer writing one `webhook_deliveries` row per
  (subscription × event), and a relay-shaped worker that signs, POSTs, and retries on the
  deterministic backoff or dead-letters.
- A hand-authored **webhook-delivery XState machine** (Pending -> Delivering -> Delivered | Retrying ->
  DeadLettered) with reverse-conformance, MBT, and the runner-emitted `xstate.transition` spans.
- A deterministic, capped, full-jittered **retry contract** (`nextBackoff`), HMAC-SHA256 signing with
  the timestamp bound in (replay defense), and an **SSRF guard** on delivery URLs.
- An in-cluster echo **webhook-receiver** as the dev/CI delivery sink.

**Testing techniques introduced.**
- Delivery-guarantee property testing: every event reaches a terminal state, never silently lost;
  Delivered implies the receiver returned 2xx (a flaky receiver double + FakeClock, no sleeping).
- Retry-contract property testing: an exponential, capped, seed-determined schedule, asserted as a
  pure function.
- Receiver-idempotency testing: at-least-once -> exactly-once-effects via a stable delivery id.
- HMAC signature + replay-window property testing.
- SSRF-guard property testing (every private/loopback/link-local target rejected).
- A message-pact for the **outbound payload** (QARoom as *provider*, the receiver as *consumer*),
  cross-checked against the five event schemas; reverse-conformance of the delivery machine; chaos of
  a flaky receiver.

**Exit criteria.**
- The delivery machine and the retry contract are observable (`/system/state`, `.../deliveries`).
- A deliberately linear/uncapped backoff fails the retry-contract property; restoring the
  capped-exponential schedule turns it green.
- A drop-on-failure worker fails the at-least-once property; the correct worker delivers a K-times
  flaky receiver in K+1 POSTs.
- A non-stable delivery id breaks receiver dedup; a stable id makes the effect exactly-once.
- A body-only signature replays across timestamps; binding the timestamp in closes it.
- An off-model delivery transition is caught by reverse-conformance though the endpoint looks healthy.
- A down/slow receiver chaos experiment shows deliveries retry on the documented backoff and converge
  on recovery (failure-modes §08); removing the retry mitigation breaks convergence.
- The new service's OpenAPI / AsyncAPI / MCP-manifest drift gates are green; ADR-0019 committed.

**Risk and mitigation.** Risk: scope creep into a full delivery platform (dead-letter UI, secret
rotation, per-subscriber limits). Mitigation: v1 is one delivery path + the retry contract + HMAC +
SSRF guard; the rest is future. Risk: the arbitrary-outbound-URL SSRF surface. Mitigation: the
injectable guard rejecting private targets, with DNS-rebinding hardening documented as a follow-up.

**Dependencies.** Reuses the Milestone 4 messaging consumer + `processed_events` dedup, the
Milestone 5 XState / reverse-conformance discipline, and the Milestone 1 Schemathesis/Pact surfaces.

---

## Milestone 12: Moderator v2: retrieval-grounded RAG + the eval / red-team stack

Post-v1, built. Re-scopes the Milestone 9 moderator from a prompt-baked classifier into a genuine retrieval-grounded RAG agent, and realigns the LLM-testing stack. Recorded in [ADR-0020](adr/0020-moderator-rag-and-eval-stack.md) (Accepted); supersedes ADR-0017's tool choices and extends ADR-0018. Does **not** modify any ADR-0001 commitment.

**Goal.** Make retrieval *load-bearing* so retrieval quality and agentic behaviour become first-class testable surfaces, then demonstrate RAG, RAG-evaluation, agentic-evaluation, and LLM red-teaming as distinct techniques. Honest framing: a demonstration re-scope, not product necessity; the functional upgrades are genuine improvements, so the tools follow the requirements rather than the reverse.

**Scope (built).**
- **Retrieval-grounded moderator (FR1–FR6).** Per-community policy corpus (rules + escalation guidelines + prior decisions) embedded in `pgvector`; retrieve-then-reason; citation-bearing verdict (`cited_rules[]`, `precedents[]`, `rationale`); precedent consistency (or an explicit `departs_from_precedent` flag); abstain/escalate on low retrieval confidence or conflicting rules; observable LangGraph trajectory. The structured-output contract extends with `disposition ∈ {approve, remove, escalate_to_human}`.
- **DeepEval: single CI eval harness.** Native RAG metrics (faithfulness, contextual precision / recall / relevancy), agentic metrics (task completion, tool correctness, trajectory), and custom G-Eval metrics (precedent-consistency, calibration). Pytest-native, vendor-neutral judge. RAGAS is *not* adopted separately: its metrics are demonstrated via DeepEval's `RAGASMetric` wrapper in one named eval.
- **DeepTeam: red-team.** `model_callback` wraps the moderator; OWASP LLM Top 10; headline target is **prompt-injection-in-post-body** (untrusted content flowing to the LLM). PyRIT optional nightly for multi-turn depth.
- **Promptfoo dropped**: OpenAI acquired it (March 2026), realizing the conflict ADR-0017 flagged. `summary.json`: the `promptfoo` runner is replaced by `deepeval` + `deepteam` runners (frozen envelope untouched).
- Metamorphic paraphrase-invariance and LangGraph reverse-conformance are retained (ADR-0017).

**Testing techniques introduced.**
- RAG as a tested retrieval-grounded pipeline.
- RAG evaluation (faithfulness, context precision/recall) via DeepEval.
- Agentic evaluation (task completion, tool correctness, trajectory).
- LLM red-teaming (OWASP LLM Top 10) via DeepTeam.

**Exit criteria (met).**
- A planted hallucinated-policy regression is caught by the faithfulness metric and *missed* by a non-grounded eval, demonstrating why grounding matters.
- Retrieval precision/recall is gated in CI; a corpus-retrieval regression fails the gate.
- The abstain path fires on a low-confidence / conflicting-rules case (calibration metric green).
- A prompt-injection-in-post-body attack is caught by DeepTeam; removing the input-guard mitigation breaks it.
- `deepeval` + `deepteam` runners land in `summary.json` with no schema change, key-gated + cost-guarded.
- ADR-0020 committed.

**Dependencies.** Extends the Milestone 9 moderator (LangGraph / pgvector / OpenAI), the metamorphic + reverse-conformance discipline (ADR-0017), and the `summary.json` runner-fold mechanism (Commitment 14).

**Risk and mitigation.** Risk: the re-scope balloons into a full moderation platform (appeals UI, dead-letter, per-rule analytics). Mitigation: v1 is one corpus + retrieve-then-reason + citation schema + abstain path; the rest is future. Risk: a larger eval surface costs more tokens per CI run. Mitigation: the existing cost-guard + key-gate (ADR-0017). Risk: DeepTeam's CI-maturity caveat. Mitigation: pair PyRIT for depth and use DeepTeam's GitHub-Actions integration.

---
