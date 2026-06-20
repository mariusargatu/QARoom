# messaging

The NATS JetStream layer, built on `@qaroom/otel` (W3C trace context rides the message headers).
Owns the durability seams every service shares: transactional outbox, dedup, idempotency-replay,
relay, and TTL GC. Read the repo-root `AGENTS.md` first.

## What lives here

- **`outbox.ts` + `relay.ts`**: the transactional outbox (Commitment 17). `outboxPublish` writes the
  event in the SAME tx as the business write; `createRelay` drains `FOR UPDATE SKIP LOCKED` and
  publishes each row with its stable `Nats-Msg-Id` and restored trace context — at-least-once, never
  lost. `connection.ts` sets the stream's 5-minute `duplicate_window`.
- **`dedup.ts` + `subscribe.ts`**: exactly-once *effects* over at-least-once delivery. `processEvent`
  runs the handler and `markProcessed` in one tx; consumers dedupe via the `processed_events` table
  (`alreadyProcessed`, advisory-locked, single-writer). `consume-loop.ts`/`drain-loop.ts` are the
  shared resilient-consume + background-timer shells.
- **`idempotency.ts`** (subpath `@qaroom/messaging/idempotency`, NATS-free): the `Idempotency-Key`
  replay store (Commitment 4) — `service-kit`'s `withIdempotency` imports it without the broker.
- **`gc.ts` + `gc-job.ts`**: TTL hygiene ONLY (Commitment 17) — sheds aged *published* outbox rows +
  dedup tables; never an unpublished outbox row. `migrations.ts`: the outbox/processed_events/
  idempotency_responses fragments, composed per service.

## Conventions enforced here

- **Every event has a Zod schema and a name** — but those schemas (`src/events/`) and the
  `subjects.ts` subject builders both live in **`@qaroom/contracts`**, not here. This package
  *transports* typed events; it never owns the grammar. `Nats-Msg-Id` is the event's `evt_<ulid>`
  (from the `IdGenerator`), reused verbatim so a relay restart is deduped by JetStream.
- **Migrations are fragments.** Full adopters (content/flags/donations) apply all three; pure
  consumers apply only what they have (webhooks has no `outbox`, identity only the idempotency store).
- **Determinism holds:** every timestamp/cutoff comes from the injected `Clock`, never `new Date()`;
  `SystemClock` is constructed only at the `gc-job` CLI composition root. **Production code must
  never import from testing-utils** (it is a devDependency here, for PGlite-backed tests only).

## Commands

```bash
pnpm --filter @qaroom/messaging test       # vitest (PGlite: dedup/idempotency/relay/gc/migrations)
pnpm --filter @qaroom/messaging typecheck
```
