# How the tests work (and how to judge them)

QARoom has a lot of tests. This page is for a reader who wants to judge whether they're *good* — not just
that they're green. It points at the strongest examples, is honest about where the automated gates stop, and
tells you what to distrust on sight. If you only read one thing about testing here, read this.

The governing idea: **a test is only worth the bug it would catch.** Every headline guarantee ships with the
deliberate bug that breaks it and a command to watch a real test go red (`pnpm prove <id> --break`); see
[claims.md](claims.md). The rest of the suite is held to the same bar — the examples below show what that
looks like in practice.

## How tests are organized

- **Unit** — `src/foo.ts` ↔ `src/foo.test.ts`, co-located.
- **Integration** — `src/foo.spec.ts` (or `tests/*.spec.ts`), exercises a real in-process Postgres (PGlite).
- **Property** — `*.property.test.ts`, fast-check invariants alongside the unit tests.
- **Contract** — `services/<consumer>/tests/contracts/` (Pact), provider verification in the provider.

> **Honest caveat:** the `.test` / `.spec` split is a *navigational* convention, not a gate. Nothing selects
> a vitest project on `*.spec.ts`, and lint/coverage treat both identically. A mis-tiered file is invisible.

## Read these first — the strong exemplars

These are the tests to open if you want to see the ceiling, not the floor:

- **Property oracle built against vacuous pass** — [`services/content/src/tenancy.property.test.ts`](../services/content/src/tenancy.property.test.ts).
  An arbitrary interleaved sequence of posts across three communities; every feed must contain exactly its
  own. The `expected` counts are derived from the *input sequence*, **not** the system's own response — the
  comment says why: a regress-to-400 would otherwise pass vacuously. That is the single most important habit
  in property testing, and it's explicit here.
- **A real Postgres invariant, not happy-path CRUD** — [`services/content/tests/rls-second-layer.spec.ts`](../services/content/tests/rls-second-layer.spec.ts).
  Creates a non-superuser role, `SET ROLE`s to it, *removes the service-layer `WHERE` filter entirely*, and
  proves Row-Level Security still hides another tenant's rows. It even handles the subtlety that RLS is
  bypassed by the table owner and only bites for a non-superuser — which is exactly how a deployed service
  connects.
- **Concurrency invariant with real contention** — [`services/content/src/single-writer.property.test.ts`](../services/content/src/single-writer.property.test.ts).
  Fires concurrent votes and asserts the final score equals the sum over *distinct* voters.
- **Differential correct-vs-bugged** — [`services/webhooks/src/signing.property.test.ts`](../services/webhooks/src/signing.property.test.ts).
  Asserts the correct signer, then asserts a deliberately bugged signer (armed by a `CHAOS_*` env) produces a
  *different* signature — the test that proves the guarantee has teeth.

## The teaching test — weak vs strong, side by side

[`services/content/tests/agent-gaming.spec.ts`](../services/content/tests/agent-gaming.spec.ts) deliberately
ships a **labelled "green theater"** weak-oracle test next to the strong invariant test, to demonstrate the
difference in one file. If you read only one thing to calibrate what this repo considers a *weak* test versus
a *real* one, read that pair. (This is intentional; it is not a slip.)

## Where the automated gates stop — read the code, not just the title

A custom lint plugin ([`tools/eslint-plugin-qaroom`](../tools/eslint-plugin-qaroom/index.js)) enforces real
structural discipline: no snapshots, no conditional logic in tests, no unseeded time/randomness in
production code, subject-grammar builders only. Those genuinely bite. But be aware of what they *cannot* do:

- **`test-name-shape` is title-only.** It rejects low-signal titles (`works`, `foo()`) but cannot see the
  body — a strong-sounding title can front a weak assertion. (The teaching test above is the proof.) So: to
  judge a test, read its assertions, not its name.
- **The web API-client parse block is a thin per-method smoke tier, on purpose.**
  [`services/web/src/api/client.test.ts`](../services/web/src/api/client.test.ts) has ~25 cases that stub a
  fixture and assert a field or two came back — near-tautological on their own. They exist to smoke each
  client method against its endpoint; the *real* parse guarantee (that the Zod contract and the emitted
  JSON-Schema agree) lives in the roundtrip parity property
  ([`packages/testing-utils/src/generators/roundtrip.property.test.ts`](../packages/testing-utils/src/generators/roundtrip.property.test.ts)).
  Read that block as a low tier, not as the contract's real defense.
- **The live-model LLM thresholds are a floor, not a target.** The keyed DeepEval metrics gate at `0.5`,
  which is permissive — a regression has to be severe to trip them. They're a weekly *measurement* signal,
  not the merge-time guarantee (that's the deterministic seam below).

## Testing the AI without pinning its output

The moderator is non-deterministic, so it is tested by the **rules that must always hold**, hermetically,
with no API key on the merge lane:

- **Safety invariant as an invariant** — [`tests/test_selfcheck.py`](../services/moderator-agent/tests/test_selfcheck.py)
  proves the never-confidently-approve-a-flagged-item guard fires, its red state, and a both-ways
  parametrized case pinning *which* condition triggers it.
- **Prompt-injection guards on real payloads** — [`tests/test_guard.py`](../services/moderator-agent/tests/test_guard.py)
  defeats the nested-delimiter re-formation escape (the real attack), not a toy string.
- **The whole graph on deterministic fakes** — [`tests/test_workflow_decision.py`](../services/moderator-agent/tests/test_workflow_decision.py)
  drives all six nodes with scripted models: idempotency, redelivery, fail-fast on a broken invariant.
- **Record/replay cassette** — [`tests/test_llm_cassette.py`](../services/moderator-agent/tests/test_llm_cassette.py)
  runs the real workflow over recorded model output keylessly, with a key that changes when the prompt does.

The live DeepEval / DeepTeam / PyRIT stack runs weekly and is key-gated (it honestly *skips*, loudly, without
a key). Treat its presence as a measurement lane — **the merge-time LLM guarantees are the deterministic
tests above**, not the model-behavior evals.

## The one-line summary

Strong tiers: the property tests, the PGlite integration specs, the deterministic moderator seam. Thin-on-
purpose tiers: the web API-client parse smoke, the `0.5` live-eval floor. Gate blind spots: titles don't
imply bodies; the `.test`/`.spec` split isn't enforced. Read assertions, trust the `--break` proofs, and use
[the detection matrix](detection-matrix.md) for what's *not* covered.
