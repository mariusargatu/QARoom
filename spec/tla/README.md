# TLA+ spec suite: the consistency-critical protocols

Verifiable-invariants experiment, **Phase 3** (ADR-0024). A small suite of TLA+ models of QARoom's
concurrency- and consistency-critical protocols — the properties the type system and example tests
cannot reach, proven exhaustively over *all* interleavings of a bounded model.

These are **design-time proofs**, deliberately **off the blocking PR path**. They are not run by
`pnpm verify` or the gauntlet; they are the **Tier-B** check a dispatched CI lane runs via
[`check.sh`](check.sh). What *is* on the normal in-process path is the **runtime-assertion binding per
spec** (below), so the models and the code cannot quietly drift. The wider consistency-verification
story — TLA+ vs MBT×fault vs DST vs Elle — is [`docs/consistency-verification.md`](../../docs/consistency-verification.md).

## The specs

| Spec | Models | Safety invariants | Liveness | Runtime binding |
|---|---|---|---|---|
| [`WebhookDelivery.tla`](WebhookDelivery.tla) | the delivery worker (`services/webhooks`) | `NoSilentDrop`, `ExhaustionLegit`, `NoStuckDelivery` | `EventuallyTerminal` | `services/webhooks/src/delivery-invariant.ts` |
| [`Rollout.tla`](Rollout.tla) | the donation-rollout machine (`packages/contracts`) | `EnabledImpliesCanary` | `EventuallySettles` | `services/flags/src/rollout-invariant.ts` |
| [`Dedup.tla`](Dedup.tla) | at-least-once consumer dedup (`packages/messaging`) | `NoDoubleApply`, `RecordedIffApplied` | `EventuallyProcessed` | `packages/messaging/src/dedup-invariant.ts` |
| [`Outbox.tla`](Outbox.tla) | the transactional outbox + relay (`packages/messaging`) | `PublishedImpliesCommitted`, `SentImpliesPublished` | `EventuallyDelivered`, `CommitLeadsToSent` | `packages/messaging/src/outbox-invariant.ts` |

Each is the **committed-state projection** of a hand-authored machine or messaging protocol — it models
what is *persisted*, collapsing the in-memory legs that a crash discards. Two liveness shapes are worth
calling out:

- **`Rollout` is non-terminating by design.** Enabled is a settled gate, not a final state, and the
  reverse path returns to Off. So its liveness is **non-starvation** — `[]<>(status ∈ {Off, Enabled})`,
  "always eventually settles" — not "eventually terminal".
- **`Dedup`/`Outbox` bound the broker.** `MaxDeliveries` / `MaxAttempts` keep the model finite; the
  at-least-once liveness premise (the broker eventually accepts) is the bounded failure-then-success path.

## How to run

```bash
spec/tla/check.sh                 # TLC over all four specs; non-zero if any is not green
spec/tla/check.sh Rollout         # one spec
TLA_TOOLS_JAR=/path/tla2tools.jar spec/tla/check.sh
```

`check.sh` needs Java (17+); it downloads the pinned `tla2tools.jar` once if absent (gitignored). Or run
TLC directly:

```bash
java -cp tla2tools.jar tlc2.TLC -config Rollout.cfg Rollout.tla
# expect: "Model checking completed. No error has been found."
```

**Apalache** (optional, symbolic/SMT) does not support `ENABLED`, so drop `NoStuckDelivery` (or rephrase
it as an action precondition) before running it on `WebhookDelivery.tla`.

## The spec-level falsifiers

Every spec carries a **commented falsifier action** — the model twin of a deliberate-bug toggle.
Uncomment it (and the falsifier `Next` line) and TLC reports a trace violating the named invariant. Each
was verified to red:

| Spec | Falsifier | Reds | Code twin |
|---|---|---|---|
| `WebhookDelivery` | `DropOnFail` | `NoSilentDrop` | `CHAOS_WEBHOOK_DROP_ON_FAIL` |
| `Rollout` | `MisrouteCanary` (Enabling → Enabled, skipping Canary) | `EnabledImpliesCanary` | `FLAGS_BUG_CANARY_MISROUTES` |
| `Dedup` | `BugDeliver` (apply without recording) | `RecordedIffApplied` / `NoDoubleApply` | deleting `markProcessed` |
| `Outbox` | `BugMarkSentOnFail` (mark sent without a publish) | `SentImpliesPublished` | an outbox drop-on-fail bug |

Model and code, falsifiable the same way.

## The runtime bindings (this is what's on the normal path)

Each spec has a `*-invariant.ts` that is the **persisted-state projection of its `Next` relation**,
unit-tested so a **planted illegal transition throws** (proof the assertion has teeth). This is what
connects the model to the implementation rather than letting them run in parallel:

- **`assertLegalDeliveryCommit`** (webhooks) and **`assertLegalOutboxCommit`** (messaging) are *called*
  before the relevant `persist` — the worker's commit, and `relay.ts#publishOne` before stamping
  `published_at`. An off-protocol commit throws at the real boundary.
- **`assertLegalRolloutTransition`** is a tested projection that is **deliberately not** wired into
  `advanceRollout`: the `FLAGS_BUG_CANARY_MISROUTES` demo persists a coherent-but-illegal `Enabling →
  Enabled` commit on purpose, and a structural guard there would short-circuit the very bug MBT exists to
  catch. A drift test derives the machine's true edges and asserts the binding matches, so it cannot
  diverge from the one source.
- **`assertIdempotentApply`** (messaging) is the `NoDoubleApply` boundary projection; the live guard is
  `alreadyProcessed` and the end-to-end defence is the duplicate-delivery property test.

The bindings are checked **structurally**, so they never fight the *semantic* chaos demos (which produce
structurally legal but semantically wrong commits — caught by the at-least-once / duplicate-delivery
property tests instead).

## MBT × fault and DST

`spec/tla/` proves the protocols exhaustively. Two executable companions exercise them:

- **MBT × fault** — `services/webhooks/tests/mbt/delivery-crash.pbt.spec.ts`: model-generated command
  sequences over the delivery machine with a crash injected at a transition, asserting the
  `WebhookDelivery.tla` invariants on committed state through the fault.
- **DST** (T20/T22, merged) — `services/webhooks/tests/dst/`: one real service + a simulated world + one
  seed, which *finds the trace* the proof says cannot exist.

Full DST (cluster-wide, hypervisor-level) stays **rejected** by ADR-0001 Commitment 8; see
[`docs/consistency-verification.md`](../../docs/consistency-verification.md).
