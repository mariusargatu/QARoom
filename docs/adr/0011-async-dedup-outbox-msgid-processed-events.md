# ADR 0011: Operationalizing Commitment 17: outbox, `Nats-Msg-Id`, `processed_events`, and the accepted async-fuzz gap

- **Status:** Accepted
- **Date:** 2026-06-03
- **Records:** the Milestone 4 implementation of Commitment 17 (at-least-once async with
  explicit dedup) in `@qaroom/messaging`, the tests that verify it, and the deliberate
  decision *not* to ship an async fuzzer. Does not modify ADR-0001; it pins how the commitment
  is realized and states a scope boundary plainly.

## Context

ADR-0001 Commitment 17 commits to a four-part dedup discipline so that JetStream's
at-least-once delivery cannot produce observable double-effects. Milestone 4 implements that
discipline in `@qaroom/messaging` and must prove it under test. It must also confront a gap
the REST side does not have: there is no Schemathesis-equivalent that can fuzz an async system
from its spec. This ADR records the implementation, the verification, and why the gap is
accepted rather than papered over with a half-tool.

## Decision

1. **Commitment 17, operationalized.** Each of the four parts maps to a concrete Milestone 4
   mechanism:
   - **(a) Publisher side.** Every publish sets `Nats-Msg-Id` to a deterministic `evt_<ulid>`
     from the injected `IdGenerator`. The JetStream stream is configured with
     `duplicate_window: 5m`, so a same-`Msg-Id` republish is dropped within the window.
   - **(b) Publish atomicity.** Transactional outbox: the event row is written in the **same**
     Postgres transaction as the business write, via `outboxPublish(tx, event)` in
     `@qaroom/messaging`. A per-service in-process relay loop drains unpublished rows to
     JetStream, retries on failure until ack, and republishes each row under its **stable**
     `Msg-Id`: so a relay retry after a partial failure is deduped by (a), not double-emitted.
   - **(c) Consumer side.** A per-subscription `processed_events` table. The handler's effects
     **and** the `processed_events` insert run in **one** transaction, serialized by a
     tx-scoped Postgres advisory lock; a second delivery of the same `event_id` finds the row
     and is skipped.
   - **(d) Cross-window safety.** `processed_events` is the **contract**. The 5m JetStream
     `duplicate_window` is an **optimization**: it cheaply absorbs the common fast-retry case,
     but the guarantee that survives a redelivery beyond 5m is the table, never the window.

2. **The tests that verify it.**
   - A **fast-check duplicate-delivery property** fires the same event at a deliberately
     **non-idempotent** handler and asserts no observable double-effect. Removing the
     `processed_events` insert makes the property fail: that is the Milestone 4 dedup
     **deliberate-bug demo**, proving the test actually defends the boundary rather than passing
     vacuously.
   - A **Pact message contract** asserts the publisher sets `Nats-Msg-Id` on **every** emit.
   - The relay is **in-process**, exposing a `drainOnce()` seam so tests drive it
     deterministically instead of racing a background loop. NATS is deployed as a
     **single-server raw manifest** with `duplicate_window: 5m`.

3. **The async-fuzz gap is accepted.** See the section below for the full reasoning. The
   short version: no point-at-the-spec async fuzzer exists for our system, the closest tool
   does not support NATS, and shipping a self-authored generator pretending to be one would be
   dishonest. We close the achievable 80% and name what we give up.

## The async-fuzz gap, accepted

There is no Schemathesis-for-async in QARoom's stack, and that is a considered position, not a
backlog item.

**Root cause: the spec carries no causal oracle.** OpenAPI is *operation-centric*: each
operation declares its inputs and its allowed responses, so the test oracle (input -> declared
responses) lives in the spec for free, and a fuzzer can point at the spec and go. AsyncAPI is
*channel-centric by design*: it describes what flows on a channel, never "a receive on channel
A causes a send on channel B". That decoupling **is** pub/sub. So no causal oracle is
derivable from the spec. A black-box AsyncAPI fuzzer can only check the **weak** oracle (didn't
crash, didn't emit off-schema), never the **interesting** one (emitted the *correct* event,
held invariant X). The moment the oracle must be hand-written per system, the "point at the
spec and go" value of Schemathesis/EvoMaster evaporates, which is precisely why the unsolved
part of async testing is always the consumer side.

**Why an evolutionary search engine cannot port.** Pub/sub severs, at once, the four things an
EvoMaster-style feedback loop needs:
1. **No synchronous observation point** ⇒ no per-candidate fitness gradient to climb.
2. **No input->output attribution**, batching, windowing, 0-or-N emits, and reordering break
   the correspondence between a sent payload and an observed effect, absent correlation
   infrastructure you would have to build.
3. **No quiescence / "done" signal**: each iteration must wait out a window, making the loop
   slow and flaky, which kills the *volume* that search depends on.
4. **The input space is temporal**: payload × ordering × duplication × gaps × timing.
   Minimizing a failing concurrent *schedule* is model-checking territory, not API fuzzing.

**Closest tool: Specmatic Async** (commercial): AsyncAPI-driven contract testing, mocking,
and generative messages; a genuine black-box driver. It supports Kafka, JMS, AMQP, SNS/SQS,
EventBridge, MQTT, WebSockets, Google Pub/Sub, and IBM MQ; but **not NATS**. QARoom is
OSS-first and NATS-based (Commitment 4), with no deployed consumer in Milestone 4. Named here
as the closest option; **not adopted**.

**QARoom's answer: the in-process, handler-level payload-space property test.** Payloads and
delivery sequences are drawn from the **committed spec** (the Zod event schemas, via
fast-check). The handler is called **directly**, no broker in the loop, so problems 1–4 do
not apply: observation is synchronous, attribution is exact, quiescence is immediate, and the
schedule is whatever the generator chose. The oracle is wired in code. This is the achievable
**80%**, and we state what it gives up: serialization, broker delivery semantics, and real
ordering; and its generators are **self-authored**, so it cannot find the "unknown unknowns" an
independent third-party generator would. That asymmetry is the milestone's
intellectual-honesty beat:

> **REST** = Pact + Schemathesis (agreement **plus** independent exploration).
> **Async** = Pact-message + self-authored property + AsyncAPI drift gate + Tracetest.

The async column is missing the independent-exploration cell, and we say so rather than fake it.

## Consequences

- Dedup is provable, not asserted: the deliberate-bug demo makes the duplicate-delivery
  property fail on removing the `processed_events` insert.
- The relay's `drainOnce()` seam keeps the property and integration tests deterministic; the
  single-server NATS manifest keeps the broker dependency minimal for Milestone 4.
- The async testing story is honestly **one technique short** of the REST story (no
  independent black-box explorer), and the gap is documented rather than hidden behind a
  self-authored generator dressed as a fuzzer.
- If Specmatic Async adds NATS support, or an OSS AsyncAPI explorer with a usable oracle
  emerges, revisiting this is a scoped spike, not a rewrite: the property test and the drift
  gate stand regardless.

## Rejected alternatives

- **Build a black-box AsyncAPI fuzzer in-house.** Rejected: the spec carries no causal oracle,
  so a black-box fuzzer can only check "didn't crash / didn't emit off-schema." That is the
  weak oracle, already covered by the drift gate and Zod validation; the interesting oracle is
  unbuildable from the spec alone.
- **Adopt Specmatic Async.** Rejected for Milestone 4: no NATS binding, commercial against an
  OSS-first project, and no deployed consumer to point it at. Named as closest, not adopted.
- **Port an evolutionary search engine (EvoMaster) to async.** Rejected: pub/sub severs the
  four feedback-loop preconditions (synchronous observation, input->output attribution,
  quiescence, a non-temporal input space) simultaneously.
- **Drop the property test as "not a real fuzzer."** Rejected: it closes the achievable 80% at
  the handler level deterministically. Giving it up to hold out for a tool that does not exist
  would leave dedup unverified.
