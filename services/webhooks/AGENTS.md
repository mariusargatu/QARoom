# webhooks-service

Outbound delivery of QARoom's five domain events to external subscribers, with at-least-once
delivery, a deterministic retry/backoff contract, HMAC signing, and an SSRF guard (Milestone 11,
ADR-0019). A pure NATS *consumer*: it publishes nothing. Read the repo-root `AGENTS.md` first;
this service follows the donations-service template.

## Endpoints

| Method | Path | operationId | Notes |
|---|---|---|---|
| POST | `/api/communities/{communityId}/webhook-subscriptions` | `createWebhook` | mutating; `Idempotency-Key`; returns the write-once `secret`; 422 on SSRF-rejected URL; OAS `links`->getWebhook |
| GET | `/api/communities/{communityId}/webhook-subscriptions` | `listWebhooks` | secret never returned |
| GET | `/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}` | `getWebhook` | tenant-scoped; cross-tenant id 404s |
| DELETE | `/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}` | `deleteWebhook` | mutating; `Idempotency-Key` |
| POST | `.../{subscriptionId}/pause` | `pauseWebhook` | Active->Paused; 409 illegal transition |
| POST | `.../{subscriptionId}/resume` | `resumeWebhook` | Paused->Active; 409 illegal transition |
| GET | `.../{subscriptionId}/deliveries` | `listWebhookDeliveries` | the observable retry contract (attempt, next_attempt_at) |
| GET | `/system/state` | `getSystemState` | subscription + delivery-by-status counts + `as_of` |
| GET | `/system/capabilities` | `getSystemCapabilities` | MCP-tool-shaped (Commitment 7) |

## Delivery engine (the heart)

- **Fan-out consumer** (`src/consumer.ts`, durable `webhooks-fanout`): subscribes to all five
  entity-level feed subjects and, for each event, inserts one `webhook_deliveries` row per active
  subscription that subscribes to that event type. Deduped per `(WEBHOOK_FANOUT_DURABLE, event_id)`
  via `processed_events`, and per `(subscription_id, event_id)` via a unique index: the two
  at-least-once boundaries. The ledger IS the durable work queue; there is **no outbox** (webhooks
  publishes nothing: the recursion guard).
- **Delivery worker** (`src/worker.ts`, relay-shaped `drainOnce`/`start`): claims due rows
  (`next_attempt_at <= clock.now()`, `FOR UPDATE SKIP LOCKED`), drives the `webhook-delivery`
  XState machine through the runner (emitting `xstate.transition` spans for reverse-conformance),
  signs + POSTs via the injected `WebhookSender`, and on failure schedules the deterministic
  backoff (`nextBackoff`) or dead-letters. "Due" is `clock.now()`-based, so tests advance the
  FakeClock. Never sleep.
- **The sender seam** (`src/sender.ts`): the single injectable HTTP boundary. Production = `fetch`
  + `AbortController` timeout; tests = a programmable double returning `success/http_error/timeout/
  network_error`. Never throws.

## Conventions enforced here

- **Determinism (Commitment 6):** backoff jitter from injected `Randomness`; delivery ids from
  `IdGenerator`; "due" from injected `Clock`; HMAC is deterministic. No `Date.now()`/`Math.random()`.
- **At-least-once + receiver dedup:** delivery is at-least-once; each POST carries a stable
  `X-QARoom-Delivery-Id` (+ `X-QARoom-Event-Id`) so receivers dedupe. Exactly-once across an
  untrusted network is impossible: the contract is at-least-once + dedup key.
- **HMAC signing:** `X-QARoom-Signature: v1=hex(hmac_sha256(secret, ts.body))`, with the
  timestamp bound into the signature (replay defense). The `secret` is write-once (create only).
- **SSRF guard:** subscription URLs must be public https (no loopback/private/link-local hosts).
- **Deliberate-bug toggles** (env, default off): `CHAOS_WEBHOOK_NO_CAP`, `CHAOS_WEBHOOK_DROP_ON_FAIL`,
  `CHAOS_WEBHOOK_UNSTABLE_DELIVERY_ID`, `CHAOS_WEBHOOK_SIGN_BODY_ONLY`, `CHAOS_WEBHOOK_ILLEGAL_TRANSITION`
  : each flips one behavior so a property/conformance test goes red, then green when removed.

## Commands

```bash
pnpm --filter @qaroom/webhooks dev               # tsx watch (needs Postgres + NATS)
pnpm --filter @qaroom/webhooks test              # vitest (unit + property + integration)
pnpm --filter @qaroom/webhooks typecheck
pnpm --filter @qaroom/webhooks openapi:generate  # regenerate openapi.yaml from Zod + operations
pnpm --filter @qaroom/webhooks asyncapi:generate # regenerate asyncapi.yaml (receive-only consumer)
```
