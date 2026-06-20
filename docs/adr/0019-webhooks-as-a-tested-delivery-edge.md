# ADR 0019: Webhooks: an outbound delivery edge over the NATS event seam

- **Status:** Accepted
- **Date:** 2026-06-05
- **Records:** the implementation decisions for QARoom's outbound webhooks capability (Milestone 11):
  a new edge service that consumes the existing five NATS event channels and delivers them to
  external subscribers with at-least-once delivery, a deterministic retry/backoff contract, HMAC
  signing, and an SSRF guard; the delivery lifecycle as a hand-authored XState machine subject to
  reverse-conformance; and how it deploys and is tested on the shared substrate. It does **not**
  modify [ADR-0001](0001-foundational-decisions.md). It consumes the existing event seam and adds no
  new commitment. It realizes the "designed-for-later webhooks seam" recorded in
  [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §7.

## Context

The architecture always promised webhooks as a later capability: *"NATS event topics map naturally to
outbound webhook subscriptions; the abstraction exists."* Milestone 11 builds it. The point of the
milestone is not the feature. It is to demonstrate the testing techniques unique to **delivery
systems**, which the roadmap names precisely: *delivery guarantees* and *retry contracts*.

Webhook delivery is a different shape from everything before it. It crosses an **untrusted external
boundary** (an arbitrary subscriber URL), over an unreliable network, with no transaction spanning
QARoom and the receiver. That forces a cluster of decisions the rest of the platform never had to
make: delivery can only be **at-least-once** (exactly-once across the network is impossible, so the
receiver must dedupe); the retry schedule becomes a **published contract** subscribers depend on;
accepting a delivery URL is a **server-side-request-forgery** surface; and a signed payload is the
only way a receiver can trust what it received. Each of those is a testing problem, and each maps onto
an existing QARoom discipline (determinism, state machines, reverse-conformance, RFC 7807, the dedup
story of Commitment 17) rather than a new one.

## Decision

1. **A new edge service, `services/webhooks` (TypeScript, service-kit, port 8087), not a feature
   inside an existing service.** Delivery is a long-running, retrying, externally-facing concern with
   its own Postgres (subscriptions + a delivery ledger) and its own failure domain. It fans out
   **all five** event channels, so it cannot live inside any single producer without coupling
   unrelated services. It mirrors the gateway's NATS->WS feed but with durable Postgres state: that
   statefulness *is* "delivery guarantees."

2. **A delivery store + worker, outbox-free.** A durable JetStream consumer (`webhooks-fanout`)
   inserts one `webhook_deliveries` row per (active subscription × event), deduped per
   `(WEBHOOK_FANOUT_DURABLE, event_id)` via `processed_events` and per `(subscription_id, event_id)`
   via a unique index: the two at-least-once boundaries. A relay-shaped worker (`drainOnce`/`start`,
   mirroring `@qaroom/messaging`'s outbox relay) claims due rows `FOR UPDATE SKIP LOCKED`, signs and
   POSTs each, and on failure schedules the backoff or dead-letters. There is **no transactional
   outbox**: Commitment 17's outbox is publish-side, and webhooks publishes nothing. The ledger *is*
   the durable work queue.

3. **The delivery lifecycle is a hand-authored XState machine with reverse-conformance.** States
   `Pending -> Delivering -> Delivered | Retrying -> … -> DeadLettered`, invoke-free and context-free
   (the `@xstate/graph` constraint), in `packages/contracts/src/machines/webhook-delivery.machine.ts`.
   The worker drives every transition through the runner, which records an `xstate.transition` span:
   so MBT (`@xstate/graph`) and Tracetest reverse-conformance (ADR-0012) operate on this machine
   unchanged. The worker, not the machine, chooses `DeliveryFailed` vs `RetriesExhausted` (via
   `nextBackoff(...) === null`). `Delivered`/`DeadLettered` are terminal but not XState `final` (the
   rollout precedent).

4. **A deterministic retry/backoff contract.** `nextBackoff(attempt, randomness, policy)` is a pure,
   capped, full-jittered exponential schedule: jitter is drawn from the injected `Randomness`
   (Commitment 6), never `Math.random()`, and "due" is `clock.now() >= next_attempt_at`, so tests
   advance the `FakeClock` and never sleep. The policy (base 1s, ×2, 30s cap, 8 attempts) is exposed
   to subscribers and the per-delivery `attempt`/`next_attempt_at` are observable at
   `.../deliveries`. This pure function is the milestone's headline property-test target.

5. **HMAC-SHA256 signing with the timestamp bound in.** Each delivery carries
   `X-QARoom-Signature: v1=hex(hmac(secret, `${timestamp}.${body}`))` plus `X-QARoom-Timestamp`,
   `X-QARoom-Delivery-Id`, and `X-QARoom-Event-Id`. Binding the timestamp into the signed bytes (not
   merely sending it) is what closes the replay window. The per-subscription `secret` is minted from
   the injected `Randomness` and is **write-once**: returned only on create, never on reads.

6. **An SSRF guard on delivery targets.** A subscription URL must be public https: the guard rejects
   non-https schemes, embedded credentials, and hostnames that are (or obviously resolve to)
   loopback, RFC1918, link-local (incl. the `169.254.169.254` metadata IP), CGNAT, and unique-local
   addresses. It is a single pure oracle (`isPublicHttpsUrl`) shared by the Zod refine and the
   service, property-tested. DNS-rebinding (a public name that later resolves private) is a
   documented follow-up handled at delivery time.

7. **At-least-once with documented receiver-side dedup.** A delivery may be POSTed more than once
   (e.g. the receiver processed it but its response was lost). Every redelivery carries the **same
   stable `X-QARoom-Delivery-Id`**, so a receiver deduping on it applies the effect exactly once.
   Exactly-once across an untrusted network is not offered; the contract is at-least-once + a stable
   dedupe key, documented for subscribers.

8. **The subscription CRUD is gateway-proxied.** The browser/clients reach webhook management at
   `qaroom.localhost/api/...` same-origin, getting rate-limiting and a Pact consumer contract for
   free, uniform with content/donations/flags. The **delivery** side has no ingress: it is an
   outbound-only internal worker.

## Consequences

### Positive
- A clean delivery edge with an inspectable ledger (`/system/state`, `.../deliveries`); the event
  seam pays off with **zero new commitments**.
- The retry contract is a pure function, so the hardest-to-test part of a delivery system becomes the
  easiest: deterministic, seed-replayable, and the centerpiece of the test portfolio.
- Six deliberate-bug demos, each caught by a named test, so the exit criteria are mechanically
  reproducible: five env toggles in the worker (`CHAOS_WEBHOOK_NO_CAP` -> uncapped backoff,
  `_DROP_ON_FAIL` -> silent drop, `_UNSTABLE_DELIVERY_ID` -> broken receiver dedup, `_SIGN_BODY_ONLY`
  -> replayable signature, `_ILLEGAL_TRANSITION` -> off-model span), plus the chaos experiment (§08)
  that removes the retry mitigation under a down receiver (it reuses `_DROP_ON_FAIL`).

### Negative / Trade-offs accepted
- One more TypeScript service to operate (a sixth backend), with its own Postgres.
- At-least-once pushes dedup responsibility onto subscribers; we document it rather than attempt
  exactly-once.
- The SSRF guard is syntactic at write time; DNS-rebinding hardening is deferred.
- The async-fuzz gap (ADR-0011) applies again: delivery interleavings are property-sampled in-process,
  not explored by an independent stateful fuzzer (none exists). Named, not papered over. Milestone 14
  DST is where they would be *discovered*.

### Future applications
- A dead-letter replay/inspection UI; subscriber-managed secret rotation; per-subscriber rate limits
  (at the gateway, not the worker); DNS-rebinding resolve-and-pin at delivery; DST of the delivery
  interleavings under the Milestone 14 simulator.

## Rejected alternatives

- **Deliver inside the consumer / synchronously on the producing request.** Couples a producer's
  write latency to a flaky external receiver: exactly the anti-pattern failure-modes experiment 02
  warns against. Delivery must be off the request and consume paths.
- **Push over the existing gateway WebSocket.** That is *inbound* browser push (Commitment 11), a
  different audience and auth model with no retry ledger. Outbound server-to-server delivery is a
  separate concern.
- **A third-party (Svix / Hookdeck).** Buying delivery would hide the entire testing story this
  milestone exists to demonstrate: the point is to *build* the delivery guarantees, mirroring
  ADR-0001's "principles without the multi-year investment" stance.
- **A transactional outbox for deliveries.** The outbox is a publish-side pattern; webhooks publishes
  nothing. The delivery ledger already provides durability + at-least-once without it, and reusing the
  outbox would imply a NATS round-trip and risk a delivery feedback loop.

## Related decisions

- [ADR-0010](0010-sync-vs-async-and-otel-propagation-contract.md): sync/async placement and the OTel
  propagation contract the fan-out consumer reuses.
- [ADR-0011](0011-async-dedup-outbox-msgid-processed-events.md): `processed_events` dedup (reused on
  the consume side) and the accepted async-fuzz gap (restated here).
- [ADR-0012](0012-feature-rollout-state-machine-and-reverse-conformance.md): the state-machine +
  reverse-conformance discipline reused for the delivery machine.
- [ADR-0014](0014-chaos-as-property-check.md): chaos-as-property; the new failure-modes §08 entry.
- [`AGENTS.md`](../../AGENTS.md) "Milestone awareness" (Milestone 11); `services/webhooks/AGENTS.md`.
