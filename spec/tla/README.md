# TLA+ spec: webhook at-least-once delivery (spike)

Verifiable-invariants experiment, **Phase 3** (ADR-0024). A small TLA+ model of one webhook
delivery's lifecycle that proves the at-least-once / terminal-reachability protocol the type system
cannot express — under all interleavings of attempt / fail / retry / exhaust.

This is a **spike**, deliberately **off the blocking CI path**. It is not run by `pnpm verify` or the
gauntlet; it is a design-time proof you run by hand. What *is* on the normal path is the runtime
binding below, so the model and the code cannot quietly drift.

## What it models

`WebhookDelivery.tla` is the committed-state projection of the delivery worker
(`services/webhooks/src/worker.ts`) and the hand-authored XState machine
(`packages/contracts/src/machines/webhook-delivery.machine.ts`). The in-memory
`AttemptStarted → Delivering` leg is never persisted, so a crash before the DB commit leaves the row
re-claimable (the worker's transaction rolls back) and the delivery is retried — at-least-once. The
committed edges are:

```
Pending | Retrying --2xx-->            Delivered     (terminal)
Pending | Retrying --fail, budget-->   Retrying
Pending | Retrying --fail, exhausted-> DeadLettered  (terminal)
```

### Invariants checked

| Invariant | Meaning |
|---|---|
| `TypeOK` | status ∈ States, attempts ∈ 0..MaxAttempts |
| `NoSilentDrop` | `Delivered` only after a real 2xx — never a silent drop |
| `ExhaustionLegit` | `DeadLettered` only once the attempt budget is spent |
| `NoStuckDelivery` | a non-terminal delivery always has `Attempt` enabled (at-least-once spine) |
| `EventuallyTerminal` (temporal) | under weak fairness, every delivery eventually reaches a terminal state |

`MaxAttempts = 8` in `WebhookDelivery.cfg` mirrors `WEBHOOK_RETRY_POLICY.max_attempts`
(`packages/contracts/src/webhook-retry.ts`). Keep them equal.

## How to run

**TLC** (the primary checker — handles `ENABLED` and the temporal property):

```bash
# with the tla2tools.jar from https://github.com/tlaplus/tlaplus/releases
java -cp tla2tools.jar tlc2.TLC -config WebhookDelivery.cfg WebhookDelivery.tla
# expect: "Model checking completed. No error has been found."
```

**Apalache** (optional, symbolic/SMT — bounded; note it does not support `ENABLED`, so drop
`NoStuckDelivery` or rephrase it as an action precondition before running):

```bash
apalache-mc check --config=WebhookDelivery.cfg WebhookDelivery.tla
```

## The spec-level falsifier

`WebhookDelivery.tla` carries a commented `DropOnFail` action — the model twin of the
`CHAOS_WEBHOOK_DROP_ON_FAIL` deliberate-bug toggle. Uncomment it (and the `Next == Attempt \/
DropOnFail` line): it marks a failed send as `Delivered` without a 2xx, and TLC reports a trace
violating `NoSilentDrop`. The same bug in code is caught by the at-least-once property test
(`delivery-guarantee.property.test.ts`) and the `webhook-at-least-once` claim. Model and code,
falsifiable the same way.

## The runtime binding (this is on the normal path)

`services/webhooks/src/delivery-invariant.ts#assertLegalDeliveryCommit` is the persisted-state
projection of the model's `Next` relation (legal edge + `ExhaustionLegit`). The worker calls it
before **every** `persist(...)`, so an off-protocol commit throws at the real boundary. It is checked
structurally — it never fights the semantic chaos demos (those produce *structurally legal* commits;
the at-least-once property catches their semantic violation). `delivery-invariant.test.ts` pins the
predicate; the live worker suites exercise it end-to-end. This is what connects the model to the
implementation rather than letting them run in parallel.
