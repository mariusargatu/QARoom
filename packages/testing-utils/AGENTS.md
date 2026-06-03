# testing-utils

The test code as a system (docs/03 §9): harness, generators, matchers, determinism doubles, and
the Pact↔OpenAPI cross-check. **Production code must never import from here.** Read the repo-root
`AGENTS.md` first.

## What lives here

- `determinism/` — seeded doubles (`FakeClock`, `SeededIdGenerator`, `SeededRandomness`) for the
  Commitment-6 trio. Each has a reproducibility test: same seed ⇒ same sequence.
- `harness/` — `setupServiceTest` (fresh pglite + seeded trio + app) and `createSeededDeps` (the
  single wiring site for the trio). The `LamportGate` is NOT wired here — app factories derive it
  from the same seeded `ids`, so wiring one in the harness would be a redundant second source.
- `generators/` — fast-check arbitraries. Reach for an existing one before writing a new generator.
- `matchers/` — `expectRFC7807`, `expectLamportAdvanced` / `expectLamportStable`, content-type matchers.
- `contract-crosscheck/` — the Pact↔OpenAPI **shape** cross-check (Commitment 3 triangulation).

## Test layout conventions (all milestones)

- **Co-located unit:** `src/foo.ts` ↔ `src/foo.test.ts`. **Integration:** `src/foo.spec.ts`.
- **Property:** `*.property.test.ts`, alongside the unit test.
- **Contract:** `services/<consumer>/tests/contracts/`; provider verification in the provider.
- **E2E + MBT** (Milestone 5): `services/web/tests/e2e/`, authored as Screenplay Tasks; paths from XState.
- **Component** (Milestone 5): `services/web/tests/components/`, the same Tasks via Playwright CT.
- **Chaos** (Milestone 6): `chaos-experiments/<name>.yaml` paired with `tests/chaos/<name>.test.ts`.
- No conditional logic in tests; no `toMatchSnapshot`; names describe the invariant, not the function.

## Commands

```bash
pnpm --filter @qaroom/testing-utils test
pnpm --filter @qaroom/testing-utils typecheck
```
