# ADR 0010: Sync/async placement, the OTel propagation contract through NATS, and the Milestone 4 consumer scope

- **Status:** Accepted
- **Date:** 2026-06-03
- **Records:** the Milestone 4 implementation choices for Commitment 4 (sync REST + async
  messaging hybrid) and the propagation seam built in Milestone 3 (`@qaroom/otel`). Does not
  modify ADR-0001; it pins the Milestone 4 placement, trace-context, and scope decisions.

## Context

ADR-0001 Commitment 4 says REST is for queries and external-facing endpoints, NATS JetStream
is for cross-service state-change events, all HTTP mutations carry an `Idempotency-Key`, and
async delivery is dedup'd per Commitment 17. Milestone 3 shipped `@qaroom/otel` with W3C
trace-context inject/extract over a `Record<string, string>` carrier and a `tenant.id` span
processor. Milestone 4 builds the async layer on top of it: `@qaroom/messaging` (outbox,
relay, `processed_events`, `idempotency_responses`). This ADR records where each interaction
lives, how a trace stays coherent across the sync/async seam, and the precise scope of what
Milestone 4 builds versus defers.

## Decision

1. **Sync vs async placement.** REST stays the boundary for queries and anything an external
   caller drives synchronously: a caller that needs an answer in the response gets one over
   HTTP. Cross-service *state-change* events go over NATS JetStream: `content` emits
   `post.created` when a post is written and `vote.cast` when a vote is recorded. The split is
   along observation, not preference: the writer must not block on, or know about, who reacts
   to a state change (that decoupling is the point of pub/sub), whereas a query has a single
   caller that needs the result now. Mutations therefore do their synchronous business write
   over HTTP *and* enqueue the resulting event for asynchronous fan-out. They are not
   either/or.

2. **The OTel propagation contract through NATS headers.** W3C trace context crosses the
   async seam through `@qaroom/otel`'s `injectTraceContext` / `extractTraceContext`, which
   operate on a `Record<string, string>` carrier. NATS message headers satisfy that shape:
   that is exactly the seam Milestone 3 built deliberately, so no new propagation primitive is
   introduced. On publish, the producer injects the active trace context into the message
   headers and sets a `tenant.id` header alongside it. Because the transactional outbox
   (Commitment 17) defers the publish, the relay must not capture the trace at publish time:
   by then the originating request span is long gone. Instead the trace carrier is captured
   **at enqueue**, inside the request span, and stored on the outbox row; the relay restores
   that carrier when it publishes. The PRODUCER span therefore **links** to the originating
   HTTP trace rather than to whatever ambient context the relay loop happens to hold. That is
   how a single Jaeger trace spans the synchronous HTTP request and the asynchronous emit
   coherently, even though the publish happens later and on a different loop.

3. **The `Idempotency-Key` replay contract (Commitment 4).** Every mutating HTTP endpoint
   requires an `Idempotency-Key` header. Replays are served from a per-service
   `idempotency_responses` table keyed `(idempotency_key, route, body_hash)`, storing the
   original response; a second request with the same key returns the stored response and never
   re-executes. The error contract is RFC 7807:
   - **Missing key** ⇒ `400` with `failure_domain: validation`.
   - **Same key, different body** ⇒ `409` with `failure_domain: conflict` (a key collision on a
     different payload is a client bug, not a safe replay).

4. **The Milestone 4 consumer scope refinement.** Milestone 4 builds **and fully tests both
   directions** of the `@qaroom/messaging` SDK, the publish side (outbox, relay, `Nats-Msg-Id`)
   and the subscribe side (`processed_events` dedup wrapper), at the unit, property, and
   Pact-message levels, with **no deployed consumer service**. This is sound, not a shortcut:
   - Pact **message** contracts use an HTTP proxy in place of the broker, so verifying the
     publisher's emitted message needs no running consumer.
   - The outbox/relay and the dedup wrapper are independently testable: the relay against a
     real JetStream, the dedup wrapper by calling the handler directly with duplicate deliveries.
   - The roadmap's own canonical async example is "content emits -> flags-service consumes," and
     **flags-service is Milestone 5**. It therefore becomes the first real consumer. The
     cross-service **consume-side trace assertions** (a coherent sync+async Jaeger flow that
     includes a *consume* span, and the Tracetest "unexpected downstream call" assertion) land
     in Milestone 5. **Milestone 4's Tracetest asserts the publish-side flow only.**
   - The roadmap also names "comments emit events," but the comment entity does not exist yet
     (content = posts + votes only). **Comment events are deferred until comments land.**

## Consequences

- A Jaeger trace from a `POST` request shows the HTTP server span and a linked PRODUCER span,
  even though the relay publishes asynchronously: the link is carried on the outbox row, not
  reconstructed from relay-loop context.
- `@qaroom/messaging`'s subscribe side is shipped and tested in Milestone 4 but exercises no
  network broker in CI; its first production wiring is flags-service in Milestone 5.
- The consume-side trace story (the more interesting half of "does the trace really span the
  seam") is explicitly a Milestone 5 deliverable, recorded here so it is not mistaken for a
  Milestone 4 gap.
- `comment.*` subjects and schemas are not authored until the comment entity exists; the
  subject grammar already reserves the slot (`qaroom.content.comment.<community_id>.<event>`).

## Rejected alternatives

- **Capture the trace at publish time in the relay.** Rejected: by publish time the request
  span has ended, so the PRODUCER span would link to the relay loop, not the originating
  request, defeating the coherent-trace goal. Capture-at-enqueue is the correct seam.
- **A bespoke NATS-header propagation type.** Rejected: NATS headers already satisfy the
  `Record<string, string>` carrier that `@qaroom/otel` was built around in Milestone 3.
  Inventing a second primitive would duplicate a working seam.
- **Deploy a throwaway consumer in Milestone 4 to assert consume-side traces.** Rejected: the
  real first consumer (flags-service) arrives in Milestone 5 one milestone later. A throwaway
  consumer would be dead the moment flags-service exists, and Pact-message + the handler-level
  property test already cover the subscribe SDK without it.
- **Emit `comment.*` events now.** Rejected: the entity does not exist. Authoring events for a
  non-existent entity would be untested speculation.
