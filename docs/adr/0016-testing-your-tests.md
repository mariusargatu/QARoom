# ADR 0016 — Testing your tests: when to invest in mutation testing and search-based fuzzing

- **Status:** Accepted
- **Date:** 2026-06-04
- **Records:** how QARoom adds load testing (k6), mutation testing (Stryker), and search-based
  fuzzing (EvoMaster) in Milestone 8 — the cost/benefit boundary that scopes each. Records
  *implementation* decisions only; it does **not** modify any ADR-0001 commitment. The frontend
  component-testing stack of Milestone 8 is recorded separately in [ADR-0005](0005-frontend-testing-stack.md)
  and is deliberately not re-decided here. Builds on the determinism trio (Commitment 6), the SLO
  table (`docs/slos.md` / Doc 03 §12), the locked critical-modules list (Doc 03 §11), and the
  regression catalog (ADR-0015).

## Context

By Milestone 8 the portfolio already answers *"does the code do X"* from many angles: unit,
property, schema (Schemathesis), contract (Pact), integration, MBT, trace (Tracetest), chaos, and
scenario replay. Three techniques answer a *different* question and so are the closing arguments:

- **Mutation testing (Stryker)** asks *"are the tests themselves any good?"* — it is meta-testing.
  Its failure mode is a green suite that stays green when the code is broken (assertion-free or
  over-mocked tests). Nothing else in the portfolio self-diagnoses that.
- **Search-based fuzzing (EvoMaster)** asks *"what inputs has nobody thought to write?"* — it
  optimises toward coverage/HTTP-status targets rather than only schema-valid inputs, so it reaches
  paths a *schema*-driven fuzzer (Schemathesis) won't. The seam is concrete: EvoMaster's black-box
  search can't drive a stateful create→vote sequence to 2xx (the M0 spike showed this) — that gap is
  exactly Schemathesis stateful-links territory. The two are complementary, not redundant.
- **Load testing (k6)** asks *"does it still meet its SLO under load?"* — the SLO table existed from
  Milestone 0 and became observable in Milestone 3; Milestone 8 finally *enforces* it.

All three are expensive and slow, which is *why* they land last and run only in the nightly/weekly/
merge lanes (Doc 03 §8), never on the PR-fast path. The architecture earned them: determinism (so a
surviving mutant or a fuzz finding is reproducible) and the SLO table (so load has a target) are
preconditions that already exist.

## Decision

**1. Stryker is scoped to the locked critical-modules list, never full-suite.** The list is governed
in **Doc 03 §11** as the single source of truth: voting score logic, flag resolution, donation
gating, RFC 7807 envelope construction, `LamportGate`, branded ID parsers, rate-limit token bucket.
Each owning package carries a scoped `stryker.config.json` + `vitest.stryker.config.ts` whose
`mutate` glob points at *its* module(s) and whose Vitest scope excludes the Testcontainers/pglite
specs so a per-mutant re-run stays fast. The §11 list names *logic*, not files, so mutating the
`repository.ts` that holds (e.g.) the voting-score arithmetic is faithful to the list and needs no
amendment. Configs run `inPlace` (pnpm-symlink-safe) with `ignoreStatic: true` (mutation targets
runtime logic, not static-init metadata — so a purely-static module like `ids.ts` reports `n/a`, and
its guard remains `ids.test.ts` + the `brandedIdPattern` drift test). Each config sets a
`thresholds.break` **floor** — a ratchet over the current measured baseline, not a 100% target.
**Governance: adding a module to the list is an ADR; removing one requires a retrospective.**

**2. EvoMaster runs black-box, nightly, per the Milestone-0 spike.** Pinned **v6.0.0** (Java 17), the
version the spike (`docs/spikes/01-evomaster.md`) validated against TS Fastify — note the roadmap's
"EvoMaster v3" string predates the spike; v6 is the real pin. Invocation:
`--blackBox true --schema file://services/<name>/openapi.yaml --base <url> --outputFormat JS_JEST
--outputFolder services/<name>/tests/evomaster-generated --seed 42 --maxTime 10m`. The fixed seed
makes a run reproducible; `--ratePerMinute` is dropped (throttling localhost is harmful). Generated
JS_JEST is a **disposable review artifact** (gitignored, lint-exempt via `// @generated`), never a
gate — black-box output is non-deterministic and regenerated nightly.

**3. k6 enforces the SLO table on the merge-to-main lane.** `SLO_TARGETS` in
`packages/contracts/src/slos.ts` is the single source of truth, pinned to `docs/slos.md` by
`slos.test.ts` and projected to k6 thresholds by `scripts/k6-gen-thresholds.ts`. Latency is gated on
**`http_req_waiting`** (server-side TTFB), not `http_req_duration`, so the measurement tracks the
service, not the CI runner's send/receive noise; the deliberate slow-path
(`CONTENT_BUG_VOTE_SLOW_MS`) is the hard proof of sensitivity (k6 exit 99).

**4. The gates are deterministic; the findings are not.** Each technique's *value* is realised only
when a finding is reified into a deterministic, committed test:
- a surviving mutant → a new asserting test that kills it (a real test improvement);
- a fuzz finding → a hand-lifted scenario in the regression catalog (ADR-0015);
- an SLO breach → the load test turns red.

The raw, stochastic tool output is the *discovery engine*; the deterministic test is the deliverable.

## Consequences

### Positive
- The suite now has a self-check (mutation) and an out-of-distribution input source (fuzzing); both
  stay off the inner loop, so they cost the developer nothing per-PR.
- Real findings already paid for themselves: Stryker raised `lamport.ts` from 46% → 100% by exposing
  that `read()`'s return value was never asserted; EvoMaster found a `409` (Idempotency-Key conflict)
  the OpenAPI spec never declared — both reified into committed tests (the catalog's scenario 5).

### Trade-offs accepted
- Stryker needs a per-module-scoped runner config and is slow even scoped (nightly critical / weekly
  full). String-heavy modules (RFC 7807 envelope construction) score low because literal-edit mutants
  are low-value — break floors reflect that honestly rather than chasing 100%.
- EvoMaster pulls a Java/JVM dependency into the nightly lane — accepted as a cached, version-pinned
  tool, mirroring how Schemathesis is containerised (no Python in the monorepo).
- Two of the seven §11 modules (content voting score, flags resolution) are primarily covered by
  Testcontainers specs; their mutation tier is the documented nightly-heavy extension, not the fast
  default — surfaced here rather than silently dropped.

## Rejected alternatives

- **Full-suite mutation testing.** Too slow to demonstrate well; Doc 03 §11 already excludes it.
- **Schemathesis stateful-links *as the EvoMaster replacement*.** Not needed — the M0 spike passed,
  so EvoMaster ships. The contingency stands documented: had the spike failed, a deeper Schemathesis
  `--phases stateful` story would have run nightly instead. Schemathesis stays in the portfolio for
  schema fuzzing regardless; this decision is only about the *search-based* slot.
- **EvoMaster white-box / instrumented mode.** Requires JVM-style bytecode instrumentation EvoMaster
  cannot do against a TS runtime; black-box from the committed OAS is what the spike validated.
- **Committing EvoMaster's generated suite as regression tests.** Non-deterministic, black-box,
  regenerated each run — would violate the determinism discipline and the catalog's deterministic
  contract. Reify instead.
- **Gating k6 on `http_req_duration`.** Client-side total time co-varies with the shared CI runner;
  it flakes. Server-side TTFB (or, later, the OTel server-span via Tracetest) measures the service.

## Related decisions

- [ADR-0001] Commitments 6 (determinism) and 14 (machine-readable test outputs).
- [ADR-0005] the frontend testing stack — the other half of Milestone 8, not re-decided here.
- [ADR-0015] scenarios as first-class artifacts — the catalog an EvoMaster finding lands in.
- `docs/03-testing-strategy.md` §4 (portfolio), §8 (feedback loops), §11 (critical-modules SSOT),
  §12 (SLOs); `docs/04-roadmap.md` §Milestone 8; `docs/spikes/01-evomaster.md`.
