# Two-service composition DST — content → webhooks (T22, ADR-0029)

The single-service slice ([`../README.md`](../README.md)) proved webhooks correct **in isolation** and
named two limits up front: *"single service only … a content `post.created` is injected as a payload,
not produced by a real content-service run"* and *"no LLM / moderator edge"*. This slice closes both.

It runs **content** (producer) and **webhooks** (consumer) in **one process**, over a single
**in-memory broker**, **two PGlite databases**, and **one virtual clock** — plus the **moderator** as a
seeded sim consumer on the same bus. One seed drives the whole composition: the workload, every fault,
the backoff jitter, the receiver responses, and the moderator's canned decisions — so any failure is
reproducible from `seed + commit` alone. This is the first DST slice where **determinism has to survive
a service boundary**: an event is *produced* by content's real HTTP→outbox→relay path, *crosses* a real
routing/dedup bus, and is *delivered* by webhooks' real fan-out + worker.

It is **test-only and additive** — no production code changes. The pipeline is driven by `drainOnce()`
ticks on a `FakeClock` (the TimerFactory seam was deferred; `drainOnce` exists today), so nothing here
touches a real timer.

## The composition

```
content.app  ──POST /posts,/votes──►  content.db (posts/votes + OUTBOX)
                                            │
                                   content RELAY.drainOnce()         ← real @qaroom/messaging relay
                                            ▼
                                   in-memory BROKER                  ← packages/testing-utils/scenario
                                   (subject routing · msg-id dedup · per-durable cursors · drop fault)
                                       │                  │
                        WEBHOOK_FANOUT_DURABLE      MODERATOR_DURABLE
                                       ▼                  ▼
                          webhooks fan-out         moderator stub      ← seeded decision = the LLM
                          (processEvent +          (canned disposition)   KERNEL BOUNDARY
                           fanoutHandler)
                                       ▼
                          webhooks.db (delivery ledger)
                                       │
                          webhooks WORKER.drainOnce()  ──HMAC POST──►  SimReceiver (flaky, seeded)
```

One **tick** advances every stage once (`drive.ts`); when a tick makes no progress but a delivery is
scheduled for later, the clock **jumps** to the next retry instead of sleeping.

## The in-memory broker (`@qaroom/testing-utils/scenario` → `inMemoryBroker`)

The reusable piece. Where `brokerDouble` is a publisher-only sink, this is a real bus modelling the
three JetStream properties the cross-service oracle leans on:

- **subject routing** — a durable only sees subjects matching its filters (`subjectMatchesFilter`, the
  same predicate the producer↔consumer routing cross-check uses).
- **per-durable cursors** — the fan-out and the moderator each read the whole matching stream once; an
  un-acked message is **redelivered** (at-least-once), which is the seam the consumer dedup defends.
- **msg-id dedup** — a republished `Nats-Msg-Id` (a relay restart) is swallowed by the duplicate window.

It is shaped structurally to satisfy `EventPublisher`, so the **real** `createRelay` publishes straight
into it. It has its own unit test (`packages/testing-utils/src/scenario/in-memory-broker.test.ts`).

## What it checks (cross-service invariants — `invariants.ts`)

Diffing content's **outbox** (what was produced) against the webhooks **ledger** (what was delivered):

- **No event lost** — every notifying produced `post.created` yields a **terminal** delivery for each
  matching subscription. *(The planted bug reds exactly this.)*
- **No event duplicated** — at most one delivery row per `(subscription, event)`, and no ledger row for
  an event content never produced. Holds **even though the broker redelivers** — the dedup boundary
  collapses the replay (`processed_events` + the unique index).
- **tenant.id preserved end to end** — identical at every hop: outbox community → bus `tenant.id`
  header → ledger row; and a subject can't carry a tenant its position-3 community denies.
- **Moderator consumed** — the seeded sim consumer decided every `post.created` the bus delivered it,
  exactly once, tenant preserved (the bolted-on LLM is just another well-behaved consumer).
- **HMAC binds the timestamp** — every signature equals `sign(secret, ts, body)` and changes with the ts.

A **"sometimes" floor** fails the run if nothing crossed the bus, no redelivery fired, or no decision
was recorded — an inert composition is visible, not silently green.

## The moderator stub draws the kernel boundary

In production the moderator ends in an LLM call — the one inherently non-deterministic seam in the
fleet. DST stubs **exactly that step** (`moderator-stub.ts`: a seeded canned `disposition`) and keeps
everything else real: the moderator subscribes to the same bus, gets its own durable cursor, and dedups
like any consumer. So the bolted-on LLM shows up as *"just another sim consumer whose one oracle-free
step is stubbed"* (ADR-0029), and it *proposes, never enforces* (ADR-0018) — it records a decision and
never mutates content or webhooks.

## Planted cross-service bug (the drop)

`runOneSeed(seed, { dropPublishOnce: [POSTS_FEED_SUBJECT] })` makes the broker **silently drop** the
first `post.created` publish: the publish still *resolves* (so content's relay marks the outbox row
published — content believes it shipped), but the message never lands in the stream, so webhooks never
sees it. The "no event lost" oracle goes **red**
(`event lost across the boundary: notifying post.created … seed=N commit=…`); without the toggle the
same seed is green. This is the cross-service twin of `pnpm prove … --break`: a silent producer→broker
loss **neither service can detect alone**, only the cross-service oracle catches — persisted as
`seed + commit` for replay. It lives entirely in the broker fault (a test seam); no production toggle,
no new claim, no weakened invariant source.

## Running it

```bash
pnpm --filter @qaroom/webhooks test                          # gate: 20-seed sweep + meta + planted bug
CROSS_DST_SEED_COUNT=100 pnpm --filter @qaroom/webhooks test # the dispatched NIGHTLY count
CROSS_DST_SEED_COUNT=50 CROSS_DST_SEED=1000 …                # any window; a red prints seed+commit
```

A composed world is ~1.1 s (two PGlite DBs); the 20-seed gate is ~22 s, the nightly 100 ~110 s.

## What this slice does NOT cover (named limits — ADR-0015 house style)

- **Simulated bus, not real NATS.** `inMemoryBroker` models routing + dedup + at-least-once
  **semantics**, not the wire: no network, no streams-on-disk, no flow control, a "remember everything"
  duplicate window, and delivery is **pull-drained by the test**, not pushed. JetStream's own ack/term
  poison budget is out of scope (it is the single-service slice's `settleByDeliveryBudget` concern).
- **`drainOnce` ticks, not the TimerFactory.** The relay/fan-out/worker are advanced by explicit ticks,
  not the production `setInterval` drain loops (TimerFactory was deferred — ADR-0029). The schedule is
  identical; only the driver differs.
- **Two services, not the fleet.** content → webhooks only. flags/donations/identity and the gateway WS
  feed are not in the loop; the moderator is a *stub consumer*, not the real LangGraph agent.
- **Simulated HTTP receivers.** The outbound edge is a seeded `WebhookSender` double — no sockets, no
  TLS, no SSRF resolution (unit-tested separately).
- **Bounded exploration.** A modest seed window (hundreds nightly) is sampling, not a proof. The
  exhaustive proofs are the TLA+ specs; DST raises confidence and finds traces across the boundary.
