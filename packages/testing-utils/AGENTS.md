# testing-utils

The test code as a system: harness, generators, matchers, determinism doubles, and the
Pact↔OpenAPI cross-check. **Production code must never import from here.** Read the repo-root
`AGENTS.md` first.

## What lives here

- `determinism/`: seeded doubles (`FakeClock`, `SeededIdGenerator`, `SeededRandomness`) for the
  Commitment-6 trio. Each has a reproducibility test: same seed ⇒ same sequence.
- `harness/`: `setupServiceTest` (fresh pglite + seeded trio + app) and `createSeededDeps` (the
  single wiring site for the trio). The `LamportGate` is NOT wired here. App factories derive it
  from the same seeded `ids`, so wiring one in the harness would be a redundant second source.
- `generators/`: fast-check arbitraries. Reach for an existing one before writing a new generator.
- `matchers/`: `expectRFC7807`, `expectLamportAdvanced` / `expectLamportStable`, content-type matchers.
- `contract-crosscheck/`: the Pact↔OpenAPI **shape** cross-check (Commitment 3 triangulation).
- `screenplay/`: the Tasks/Questions/Abilities vocabulary (Milestone 5; narrowed by ADR-0027). Tasks
  route through `withPageProvider().getDriver()`, never a concrete ability, so one Task source runs in
  both E2E and component tests. The seam returns a runtime-agnostic `UiDriver`
  (`getByTestId -> {click,fill,textContent}`) that both a Playwright `Page` (E2E) and a `vitest-browser`
  locator (component) satisfy. Tasks/Questions: `advanceRollout`/`theFlagState`, `castDonation`,
  `clickTheButton`/`theClickCount` (broken-atom). Locate by the shared `TESTID` contract.
- `screenplay-ct/`: `createComponentActor` (ADR-0027): adapts a `vitest-browser-react` `render()`
  result to the `InteractWithComponent` ability over a `UiDriver`. Typed structurally (no browser-runner
  import), so the core `screenplay/` stays runtime-free. Replaces the old Playwright-CT bridge.
- `http/`: `mockUpstream()` + the injectable undici `fetch` a client under test receives — the
  outbound-HTTP mock/fault seam. Node's built-in global `fetch` is NOT interceptable, so inject this one.
- `scenario/`: the deterministic scenario harness (fault primitives `failingDb` / `brokerDouble` /
  `InMemoryBroker`) composed with each service's app factory; folded by `pnpm scenario:results`.
- `contracts/`: `runProviderVerification` — the Pact **provider**-verification runner. Distinct from
  `contract-crosscheck/` (the Pact↔OpenAPI *shape* cross-check) — same word, different gate.
- `async-diff/`: the AsyncAPI drift gate (ADR-0002) — a direction-aware breaking-change classifier, the
  async mirror of the `oasdiff` REST gate; consumed by `scripts/asyncapi-verify.ts` (not a test fixture).
- `chaos/`: cluster helpers for the Tier-B chaos suites (`applyManifest`, `portForward`, `runSteadyState`).
- `live-client/`: `GatewayClient`, a typed HTTP client for live-cluster (Tier-B) tests through the gateway.

## Property-based testing discipline

fast-check's model is *many cheap iterations*; match `numRuns` to per-iteration cost.

- **Unit (pure, no I/O):** the sweet spot — high `numRuns` (global default 100). Prefer a property over examples wherever an invariant exists (`resolveFaults`, `breakerSignal`, retry-schedule math, `rowToPost`).
- **Integration (a PGlite app per iteration):** modest `numRuns` (10–15). A fresh harness per run is expensive — do not crank it. Build the harness *inside* the predicate via `withResource(acquire, use)` (`@qaroom/testing-utils/harness`): the lint-safe home for the `try/finally` (predicates can't contain `try` under the no-conditional-in-test rule), so a failing iteration or shrink replay never leaks the wasm-backed PGlite instance.
- **System (live cluster):** fast-check is the wrong tool — property-style fuzzing here is **Schemathesis** (stateful-links over the OpenAPI) and **EvoMaster**, not fast-check.
- **Sequences:** when the invariant is about a *sequence* (rollout transitions, migration edges, multi-tenant interleavings), use `fc.commands` against a model rather than rebuilding a harness per input (the Milestone-7 rollout-traversal + migration-edge suites). This also keeps integration `numRuns` honest: one long command sequence covers more than many short rebuilds.

Determinism is automatic: the global seed is pinned once (`configureFastCheck` → `fc.configureGlobal({ seed, numRuns })` in the shared setup), so a reported counter-example replays via `VITEST_SEED=<n>`. The arbitraries in `generators/` are the real asset — reach for an existing one first.

## Test layout conventions (all milestones)

- **Co-located unit:** `src/foo.ts` ↔ `src/foo.test.ts`. **Integration:** `src/foo.spec.ts`.
- **Property:** `*.property.test.ts`, alongside the unit test.
- **Contract:** `services/<consumer>/tests/contracts/`; provider verification in the provider.
- **E2E + MBT** (Milestone 5): `services/web/tests/e2e/`, authored as Screenplay Tasks; paths from XState.
- **Component** (Milestone 5 seam, consolidated onto Vitest browser mode in ADR-0027):
  `services/web/src/**/*.browser.test.tsx` co-located with each atom/molecule/organism — the same
  Screenplay Tasks via `vitest-browser-react` + `createComponentActor` (`InteractWithComponent`).
- **Stories + a11y** (Milestone 8): `*.stories.tsx` per component; `play()` + addon-a11y run headless.
- **Generated fuzz** (Milestone 8): `services/*/tests/evomaster-generated/`: disposable, gitignored,
  lint-exempt; findings are reified into the regression catalog, not run as-is.
- **Chaos** (Milestone 6): `chaos-experiments/<name>.yaml` paired with `tests/chaos/<name>.test.ts`.
- No conditional logic in tests; no `toMatchSnapshot`; names describe the invariant, not the function.

## Commands

```bash
pnpm --filter @qaroom/testing-utils test
pnpm --filter @qaroom/testing-utils typecheck
```
