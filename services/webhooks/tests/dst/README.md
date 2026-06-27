# In-process DST slice — webhooks delivery edge (T20, ADR-0029)

Deterministic Simulation Testing (DST) runs the **real** consumer + delivery worker in **one
process** against a **simulated world**, driven by **one seed**. The seed determines the workload,
every injected fault, the backoff jitter, and the receiver's responses — so any failure is
reproducible from `seed + commit` alone. The simulation **explores** the delivery state space under
fuzzed faults; [`spec/tla/WebhookDelivery.tla`](../../../../spec/tla/WebhookDelivery.tla) **proves**
the same safety + liveness properties exhaustively. DST finds the trace; TLA+ closes the space.

Webhooks is the canonical target: it *is* a delivery system — at-least-once, capped-jittered retry,
redelivery, poison/dead-letter, HMAC, SSRF — and it already ships the two oracles DST needs (the
hand-authored XState delivery machine + the TLA+ spec, bound at runtime by `assertLegalDeliveryCommit`).

This slice demonstrates the six DST components on a single boundary **without** the multi-year
hypervisor cost ADR-0001 Commitment 8 rejected. It is **test-only and additive** — no production code
changes (the `drainOnce()` + `FakeClock` seams already exist for determinism).

## The six components (and where they live)

| # | DST component | Here |
|---|---|---|
| 1 | Single process | the real `consumer` + `worker` over one PGlite (`world.ts`) |
| 2 | Virtual clock | `FakeClock`; the drive loop **jumps** to the next scheduled retry instead of sleeping (`drive.ts`) |
| 3 | One seed | `FakeClock` / `SeededRandomness` / `SeededIdGenerator`, all seeded from one int (`world.ts`) |
| 4 | Simulated world | in-memory event bus over the real `processEvent` → `fanoutHandler` path + flaky receivers (`event-bus.ts`, `sim-receiver.ts`) |
| 5 | Fault injector | seed-driven menu: event duplicate / redeliver / reorder, endpoint down/slow/500/flaky, crash mid-flight via `failingDb` (`event-bus.ts`, `drive.ts`) |
| 6 | Invariant checker + replay | liveness, at-least-once, dedup, HMAC; on red, print `seed + commit`; same-seed-twice is byte-identical (`invariants.ts`, `sweep.ts`, `runTwiceAndDiff`) |

## What it checks

- **EventuallyTerminal (liveness)** — every delivery reaches `Delivered` or `DeadLettered`; a stuck
  row blows the pass cap (TLA `EventuallyTerminal`).
- **At-least-once / NoSilentDrop** — a `Delivered` row implies the receiver really returned 2xx; a
  failed send is retried, never dropped (TLA `NoSilentDrop`).
- **Ingestion dedup** — a redelivered event never duplicates a `(subscription, event)` ledger row.
- **Receiver dedup** — a delivery's retries carry one stable `X-QARoom-Delivery-Id`, so a receiver
  can dedupe.
- **HMAC binds the timestamp** — every signature equals `sign(secret, ts, body)` and changes when the
  timestamp changes (replay defense).

A **"sometimes" assertion** fails the run if the fault menu fired nothing or no failures were
explored — so an inert simulation is visible, not silently green.

## Planted-bug severity proof

`CHAOS_WEBHOOK_DROP_ON_FAIL=1` makes the worker mark a **failed** send `Delivered`. Under the fuzzed
faults the at-least-once oracle goes **red** (`… is Delivered but no receiver POST returned 2xx … seed=N commit=…`);
remove the toggle and the same seed is green. This is the DST twin of `pnpm prove webhook-at-least-once
--break` — it reuses that existing falsifiable claim's toggle, adds no new claim, and weakens no
invariant source.

## Running it

```bash
pnpm --filter @qaroom/webhooks test                  # gate: a modest 20-seed sweep + meta + planted bug
DST_SEED_COUNT=4000 pnpm --filter @qaroom/webhooks test   # the dispatched NIGHTLY count
DST_SEED_COUNT=200 DST_SEED=1000 …                   # any window; a red prints seed+commit to replay
```

The PR gate runs **20 seeds** (`DST_SEED_COUNT`, ~0.6 s/seed). The dispatched nightly lane runs a few
thousand. A red seed is a **real finding**: persist `seed + commit` and fix the code — never soften an
oracle to make a seed pass.

## What this slice does NOT cover (the named limits — ADR-0015 house style)

- **Single service only.** It exercises webhooks' delivery boundary. It is not a cluster-wide DST;
  there is no cross-service history (a content `post.created` is *injected as a payload*, not produced
  by a real content-service run).
- **Simulated NATS, not real.** The "event bus" drives the real `processEvent` dedup path directly,
  with no broker. JetStream's own redelivery/ack/term semantics and the `WEBHOOK_FANOUT_MAX_DELIVERIES`
  poison budget (a NATS-loop concern) are out of scope here; poison shows up only as an endpoint that
  exhausts its retry budget → `DeadLettered`. The publisher-side `brokerDouble` is deliberately unused
  — webhooks publishes nothing.
- **Simulated HTTP, not real.** Receivers are a seeded `WebhookSender` double over the real outbound
  seam — no sockets, no TLS, no real SSRF resolution; the SSRF guard is unit-tested separately.
- **Events arrive as one initial batch**, not interleaved across virtual time. The retry/backoff
  schedule is fully time-driven; event *arrival* ordering is fuzzed (reorder/dup/redeliver) but not
  spread across the virtual clock.
- **No LLM / moderator edge.** That boundary is a deliberate non-deterministic append stubbed at the
  kernel; it is not part of this delivery-side slice.
- **Bounded exploration.** A modest seed window in the gate (thousands nightly) is sampling, not a
  proof — the exhaustive proof is the TLA+ model. DST raises confidence and finds traces; it does not
  replace `WebhookDelivery.tla`.
