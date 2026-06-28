# Consistency verification: TLA+, MBT×fault, Elle, and DST (T19)

QARoom's hardest correctness claims are about **concurrency and consistency** — properties the type
system and example-based tests cannot reach: *every webhook delivery is at-least-once*, *a redelivered
event applies its effect once*, *an outbox row is never marked sent without a publish*, *a rollout
never skips the canary gate*. This note records which technique defends each, and the explicit
**build-vs-defer** decisions — most importantly for **Elle**.

The layered argument, from exhaustive to executable to sampled:

| Technique | What it gives | Where |
|---|---|---|
| **TLA+ / TLC** | Exhaustive proof of safety + liveness over *all* interleavings of a bounded model | `spec/tla/` |
| **Runtime-assertion bindings** | The model's legal-transition relation enforced at the real persist boundary (model ↔ code, not parallel) | `*-invariant.ts` per service/package |
| **MBT × fault** | The same invariants asserted over model-generated command sequences with a fault injected at a transition | `services/webhooks/tests/mbt/` |
| **DST** (T20/T22, merged) | One real service + simulated world + one seed; *finds the trace* the proof says cannot exist | `services/webhooks/tests/dst/` |
| **Elle** (Jepsen) | Transactional-anomaly checking over observed operation histories | **deferred — see below** |

> TLA+ *closes the space*; DST *finds the trace*; MBT×fault *executes the model under a fault*; the
> runtime bindings *keep the model honest against the code*. Elle would attack a different surface
> (multi-key transactional isolation) — and that surface is already largely precluded by design.

## 1. The TLA+ spec suite

Four specs, each the committed-state twin of a hand-authored XState machine or messaging protocol, each
with safety **and** liveness, each TLC-green, each bound to a runtime falsifier. Full per-spec detail
and the run instructions are in [`spec/tla/README.md`](../spec/tla/README.md).

| Spec | Machine / protocol | Safety | Liveness | Runtime binding |
|---|---|---|---|---|
| `WebhookDelivery.tla` | webhook delivery worker | NoSilentDrop, ExhaustionLegit, NoStuckDelivery | EventuallyTerminal | `services/webhooks/src/delivery-invariant.ts` |
| `Rollout.tla` | donation-rollout machine | EnabledImpliesCanary (no canary-skip) | EventuallySettles | `services/flags/src/rollout-invariant.ts` |
| `Dedup.tla` | at-least-once consumer dedup | NoDoubleApply, RecordedIffApplied | EventuallyProcessed | `packages/messaging/src/dedup-invariant.ts` |
| `Outbox.tla` | transactional outbox + relay | PublishedImpliesCommitted, SentImpliesPublished | EventuallyDelivered, CommitLeadsToSent | `packages/messaging/src/outbox-invariant.ts` |

Two honest notes on the liveness shapes:

- **Rollout is non-terminating by design.** Enabled is a settled gate, not a final state, and the
  reverse path returns it to Off. So its liveness is **non-starvation** — `[]<>(status ∈ {Off,
  Enabled})`, "always eventually settles" — not "eventually terminal". Every transient state makes
  progress and every cycle returns to Off, so a settled state recurs forever.
- **Dedup/Outbox bound the broker.** `MaxDeliveries` / `MaxAttempts` make the models finite; the
  at-least-once liveness premise is that the broker eventually accepts, which the bounded
  failure-then-success path encodes.

Each spec carries a **commented spec-level falsifier** (the model twin of a deliberate-bug toggle):
uncomment it and TLC reports the exact safety violation. These were verified to red their named
invariants — e.g. `Rollout`'s `MisrouteCanary` (the `FLAGS_BUG_CANARY_MISROUTES` transfer fault) reds
`EnabledImpliesCanary`; `Outbox`'s `BugMarkSentOnFail` reds `SentImpliesPublished`.

### TLC is the proof; the bindings are on the path

TLC needs Java + the TLA tools, so — like the original `WebhookDelivery.tla` — the suite is a
**design-time proof run by hand** (`spec/tla/check.sh`), deliberately off the blocking PR lane. It is
the **Tier-B** check a dispatched CI lane runs (the script exits non-zero on any non-green spec). What
*is* on the normal in-process path is the **runtime-assertion binding per spec**: each is the model's
legal-transition relation, enforced (or pinned) at the real boundary and unit-tested so a planted
illegal transition throws. That is what stops the model and the code from silently drifting.

One binding is genuinely *wired*: `assertLegalOutboxCommit` is called by `relay.ts#publishOne` before
it stamps `published_at`. The other two are tested boundary projections with a deliberate wiring
decision recorded in their source:

- **Rollout** is *deliberately not* wired into `advanceRollout`. The `FLAGS_BUG_CANARY_MISROUTES`
  deliberate-bug persists a *coherent but illegal* `Enabling → Enabled` commit, and the whole point of
  that demo is that only a model-holding test catches it. A structural guard in the persist path would
  short-circuit the very bug the demo exists to catch, so rollout's live defence is **MBT**; the
  binding stands as `Rollout.tla`'s in-proc falsifier (its test plants exactly that edge).
- **Dedup** is a boundary projection of `NoDoubleApply`; the live guard is the `alreadyProcessed` check
  and the end-to-end defence is the duplicate-delivery property test.

## 2. MBT × fault

`services/webhooks/tests/mbt/delivery-crash.pbt.spec.ts` composes **model-based testing** (fast-check
command sequences drawn from the webhook-delivery machine) with a **fault injected at a model
transition**: a crash mid-attempt (pod-kill after the in-memory `AttemptStarted → Delivering` leg but
before the DB commit). The command layer drives the **real** machine runner, the **real**
`assertLegalDeliveryCommit` binding, and the **real** retry budget, asserting every `WebhookDelivery.tla`
invariant on committed state after each step. The crash must roll back to a re-claimable row
(at-least-once), never a silent drop, a premature dead-letter, or a stuck delivery. It is the
deterministic, model-level twin of the full-system crash the DST slice fuzzes with `failingDb`.

## 3. Elle — the deferred apex (named, with rationale)

**Elle** is Jepsen's transactional-consistency checker: it records a history of operations (reads and
writes against keys), builds the dependency graph (write-write, write-read, read-write / anti-dependency
edges), and **detects cycles** that witness Adya-hierarchy anomalies — G0 (dirty write), G1a/b/c (aborted
/ intermediate / circular information flow), G2 (anti-dependency cycles), lost updates — to decide whether
a history is compatible with a target isolation level (serializable, snapshot isolation, etc.). It is the
strongest *black-box* consistency oracle available: it needs no internal instrumentation, only the
observed history, and it explains a violation with a concrete cycle.

**Decision: recommended apex, DEFERRED. Named here, not built — and deliberately not faked with a token
demonstrator.** The rationale, honestly:

1. **It is a high-effort sub-project, not a slice.** A faithful Elle run needs (a) a per-service
   **op-history recorder** capturing reads/writes with their transactional outcomes, (b) a **workload
   generator** that produces *contending multi-key transactions* (Elle's anomalies are cross-key
   phenomena), (c) a **consistency-model choice** to check against, and (d) the Elle checker itself
   (`elle-cljc` / the Jepsen Clojure stack, or a faithful port). That is a multi-week effort whose cost
   ADR-style discipline ("complexity must earn its place") requires us to weigh against the marginal
   coverage it buys here.

2. **The anomalies Elle targets are largely precluded by design — and already verified.** QARoom is
   **single-writer-per-resource** (Commitment 4): every mutation takes a Postgres **advisory lock** plus
   `SELECT … FOR UPDATE`, serializing concurrent writes to a resource. Lost updates and dirty writes —
   Elle's bread and butter — are exactly what that discipline prevents, and it is already pinned by the
   per-service idempotency and tenancy property tests and by `Dedup.tla`/`Outbox.tla`. There is **no
   multi-key interactive-transaction workload** in QARoom whose isolation anomalies are currently
   unguarded; the outbox and the business write share *one* transaction by construction (Commitment 17),
   which is the property `Outbox.tla` proves rather than something to discover empirically.

3. **A token "Elle" would over-claim.** A hand-rolled lost-update detector over a tiny op-log is *not*
   Elle (no Adya cycle-detection, no isolation-model semantics), and shipping one labelled "Elle" would
   misrepresent the coverage. Per the project's honesty discipline, we name the real technique and its
   real gap rather than ship a demonstrator that looks like more than it is.

**When to build it.** The moment QARoom grows a genuinely **multi-key, multi-row interactive
transaction** whose correctness depends on an isolation level (a plausible future: a cross-community
transfer, or a moderation action that atomically mutates several rows under read-modify-write), Elle
becomes the right black-box oracle — the single-writer lock no longer trivially precludes the anomaly,
and the dependency-cycle witness is worth its cost. The adoption path: add an op-history recorder behind
the existing `SqlExecutor` seam, generate contending transfers, and run the history through `elle-cljc`
against snapshot-isolation. Until then, the consistency frontier is better served by the TLA+ suite
(exhaustive over the protocols that *do* exist) and DST (the trace-finder).

## 4. DST stays scoped — no superseding ADR

Full **deterministic simulation testing** (cluster-wide, hypervisor-level) remains **rejected** by
[ADR-0001 Commitment 8](adr/0001-foundational-decisions.md): the wrong runtime (Node, not a
deterministic VM) and a multi-year cost for a demonstrator. DST is **demonstrated, not built at scale**
— the scoped in-process slice is **T20/T22** (`services/webhooks/tests/dst/`), one real service against
a simulated world under one seed. T19 adds **no** DST and writes **no** superseding ADR; building
cluster-wide DST would need one, plus Code-Owner sign-off, as a deliberate decision of its own.
