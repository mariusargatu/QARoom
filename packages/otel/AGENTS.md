# otel

In-service OpenTelemetry for QARoom (Milestone 3). Transport-agnostic telemetry; M4's
`@qaroom/messaging` will depend on this and add the NATS layer (outbox, `Nats-Msg-Id`,
subject builders) on top of the propagation primitives here. Read the repo-root `AGENTS.md` first.

## What this owns
- **`startTelemetry({serviceName})`** — NodeSDK + OTLP export to the collector. Started from a
  **`--import ./src/telemetry.ts` preload** (ESM ordering: instrumentation must patch http/fastify
  before they're imported). **No-op when `NODE_ENV==='test'`** so suites stay deterministic.
- **`tenant.id` on every span** — `TenantSpanProcessor.onStart` stamps the ambient community
  (an `AsyncLocalStorage` set by `registerTenantContext`'s `onRequest` hook); non-tenant work gets
  the `system` sentinel. `onStart` (not a response hook) is load-bearing: it covers child spans too.
- **`activeSpanSink`** — bridges `LamportGate`'s `SpanAttributeSink` (the M0 seam) to the active
  span, so `qaroom.lamport` lands on spans. Replaces `NOOP_SINK`.
- **`traced(name, fn)`** — explicit child spans for DB depth (no maintained OTel auto-instrumentation
  for porsager `postgres`; ADR-0009).
- **`inject/extractTraceContext`** — W3C context over a string carrier (HTTP now, NATS in M4).
- **`startInMemoryTelemetry()`** — `InMemorySpanExporter` + the processor, for the conformance test.

## Conventions enforced here
- Determinism: no `new Date`/`Math.random`/`randomUUID` in `src`. Trace/span IDs come from the OTel
  SDK (a dependency, like `ulid`/`jose`) and are out of the `Clock`/`IdGenerator`/`Randomness` scope —
  never asserted on or persisted.
- Versions pinned **exact** (no `^`) — the OTel JS split-versioning (api 1.x stable / 2.x stable /
  0.2xx experimental) makes minor bumps risky. Re-resolve to latest stable when bumping.

## Commands
```bash
pnpm --filter @qaroom/otel test       # vitest (uses the in-memory exporter, SDK never exports)
pnpm --filter @qaroom/otel typecheck
```
