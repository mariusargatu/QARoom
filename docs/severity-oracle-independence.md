# Severity is the unit: ranking the boundary checks by oracle independence

Companion analysis for [ADR-0031](adr/0031-mutation-testing-the-testing-utils-harness-surface.md) (which
extends [ADR-0016](adr/0016-testing-your-tests.md)) and STORY **Pillar 1 — severity**. It ranks the
techniques that defend the [boundary registry](../scripts/lib/manifests/boundary-registry.ts) and
recommends, **non-destructively**, where each could climb. It promotes nothing: it is a map and a set
of recommendations, not an edit.

## The unit of quality

A test's worth is **`P(red | behavior broken)`** — its *severity* in Mayo's sense: the probability it
goes red *given* the code's behavior is actually wrong. A test that cannot go red when behavior breaks
has severity zero, however green it looks. Two instruments measure severity directly:

- **Mutation testing** (Stryker) — a surviving mutant is a behavior-break that produced no red, i.e. a
  hole in severity. The locked-6 product surface (ADR-0016) and now the harness surface (ADR-0031).
- **`prove --break`** — each falsifiable claim must turn its named gate red on demand; a claim whose
  `--break` stays green is a severity-zero gate.

The **detection matrix** is therefore a Mayo-severity table: each *bug × technique* cell asserts that a
specific break is caught by a specific check.

**Oracle independence predicts severity.** A test fails to catch a break only when its *oracle* (the
thing that decides pass/fail) can be satisfied by broken behavior. The more independent the oracle is
from the implementation under test, the harder it is to satisfy without the behavior being right — so
the higher the achievable severity. The ladder below ranks oracles by that independence.

## The oracle-independence ladder (weakest → strongest)

| Rank | Oracle | Why it sits here | What still fools it |
|---|---|---|---|
| 1. **example-assert** | a hand-written expected value | the author who wrote the code wrote the expectation; a wrong mental model is baked into both | a missed case the author never imagined; an assertion that pins an incidental field |
| 2. **property** | an invariant over author-blind generated inputs | fast-check, not the author, chooses inputs; the oracle is a law, not a row | the invariant being too weak (true of broken behavior too) |
| 3. **metamorphic** | a *relation* between outputs of related inputs | needs no known-correct answer — only that `f(x)` and `f(t(x))` relate correctly | a break that perturbs both sides equally |
| 4. **differential** | a *second independent* source agreeing | two implementations must break *identically* to agree wrongly | a shared upstream both derive from |
| 5. **proof-checked invariant** | a machine-checked proof / single-source derivation | TLC/CrossHair/a DB `CHECK` derived from one constant — the oracle is mechanized, not authored | the spec being wrong (but the spec is small + reviewed) |

## Where each boundary's lead defense sits — and the climb

Grounded in the 12 registry boundaries (`leadTechnique` quoted):

| Boundary | Lead defense today | Rank | Non-destructive climb |
|---|---|---|---|
| Trust (client→gateway) | Schemathesis fuzzing + RFC 7807 | property | already schema-property; metamorphic on idempotent retries would add a relation oracle |
| Process (svc↔svc REST) | Pact, **cross-checked vs OpenAPI** | **differential** | the OAS↔Pact cross-check is the differential rung; strong already |
| Async (events/NATS) | typed events, outbox, dedup, async Pact, Tracetest | differential | the AsyncAPI drift classifier (now mutation-gated, ADR-0031) is the differential oracle |
| State (rollout/delivery/migration) | XState + **reverse-conformance** + MBT | differential | reverse-conformance (model vs OTel spans) is differential; webhook delivery already has a **TLA+** proof (rank 5) |
| Temporal | injected `Clock`, no real time | property/example | `runTwiceAndDiff` adds a **metamorphic** determinism relation |
| Tenancy | **property-based isolation** | property | a metamorphic "swap tenant ⇒ empty result" relation would raise it |
| Identity issuance | JWKS contracts + rotation state machine | differential | contract is differential; rotation-as-machine is MBT |
| WebSocket push | one-use ticket + **polling-parity** | **metamorphic** | parity (WS ≡ polling) is a textbook metamorphic relation |
| Observability | every span carries `tenant.id`, checked live | example/property | in-proc span assertion (ADR-0028) keeps the property continuous |
| External dep (LLM) | grounding, eval, red-team, **abstain** + **paraphrase-invariance** | metamorphic | paraphrase-invariance is metamorphic; **CrossHair** on `self_check` is rank 5 |
| Payment edge | Microcks mock + injectable seam + RFC 7807 | differential | the contract mock is the differential source |
| Delivery edge | HMAC, SSRF guard, at-least-once + retries | proof-checked | `spec/tla/WebhookDelivery.tla` (TLC-verified) is the rank-5 oracle bound to the runtime machine |

**Single strongest anchors already present:** the vote `±1` DB `CHECK` derived from one `VOTE_VALUES`
constant, the webhook-delivery **TLA+** spec, and **CrossHair** symbolic execution of the moderator
`self_check` — three rank-5 oracles. The recommendation is *not* to push every check to rank 5
(complexity must earn its place): it is to **know each check's rank**, so a low-rank oracle on a
high-consequence boundary is a deliberate, recorded choice — and so mutation testing is pointed where a
weak oracle would otherwise hide.

## Refactor-tolerance: flag the change-detectors

A **change-detector** is a test that reds on a *behavior-preserving* refactor (rename, extract-function,
statement reorder, reformat). It asserts on *representation*, not *behavior*, so its severity is
miscalibrated twice over: it reds when nothing broke (noise that trains people to ignore reds) and it
can stay green when behavior *does* break (it pinned the wrong thing). `toMatchSnapshot` is the
canonical one — already lint-banned repo-wide. This heuristic catches the residual hand-rolled cases.

### The refactor-probe (the documented procedure)

Run when a test reds during a refactor you believe preserved behavior, or as a periodic spot-check on a
suspect suite:

1. **Pick a behavior-preserving transform.** Rename a symbol (TypeScript LSP rename-symbol), extract a
   helper, reorder independent statements, or reformat. Make **no** behavior change.
2. **Run the affected suite.**
3. **Any test that reds is a change-detector** — it depends on the representation you just changed, not
   the behavior you preserved.
4. **Downgrade and rewrite.** Treat it as low-severity until fixed; rewrite it to assert the *behavior*
   (an explicit expected value or, better, an invariant/relation from the ladder above). Re-run the
   probe: it should now be green.

### Why a procedure, not a static lint

The distinguishing signal — *did behavior change?* — is inherently **dynamic and semantic**; no grep can
read it. A static "asserts on a serialized blob" rule would **false-positive on the repo's legitimate
change-detectors**: `claims:verify`, `stats:render`, `render-detection-matrix --check`, `oasdiff`, and
the OpenAPI/AsyncAPI byte-gates are byte-exact change-detectors **by design** — their subject is a
*generated, derived artifact* where any representation change *is* the event they exist to catch. A lint
cannot separate the bad change-detector (a unit test pinning an incidental field of a hand-built object)
from the good one (a drift gate pinning a rendered artifact). So the flag is a **procedure plus a
standing allowlist**: the drift gates are sanctioned change-detectors; everything else that fails the
probe is a defect to rewrite.

## Deferred (named, not built — depend on T23/T24 or a frozen invariant)

- **Diff ratchets** — patch-coverage on push, changed-line mutation nightly. Need the T23 governance
  ledger + T24 CI tiering to decide what a PR is accountable for. Not in this slice.
- **`flake_rate` / per-test severity fields** in `test-results/summary.json` — its schema is **frozen**
  (Commitment 14); a severity/flake field is a schema change behind its own ADR. The flake posture
  (quarantine vs. red) is deferred with it.
- **Full harness mutation pass** (the pglite fixture, migration discipline, the matchers) — a dispatched
  nightly lane, per ADR-0031; this slice mutates only the bounded pure core.
