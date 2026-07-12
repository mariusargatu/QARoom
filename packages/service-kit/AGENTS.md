# service-kit

The shared Fastify service runtime: the one assembled shell + cross-cutting registrars every QARoom
backend reuses, so no service re-implements Problem Details, health, `/system/*`, or idempotency.
Read the repo-root `AGENTS.md` first.

## What lives here

- **`service-app.ts`**: `buildServiceApp` — the canonical shell in its one correctness-relevant
  registrar order: `tenant context -> RFC 7807 handler -> health -> domain routes -> /system/state +
  capabilities -> snapshot`. The order is load-bearing. Each service's `buildApp` shrinks to "wire
  deps, hand over routes + models".
- **`problem.ts`**: the single RFC 7807 handler (Commitment 13). Every non-2xx carries
  `retryable` / `next_actions` / `failure_domain`; a 500 leaks NO underlying message.
- **`health-routes.ts`** (`/health` DB-free liveness, `/ready` injected readiness → 503),
  **`system-routes.ts`** (`/system/state` + `/system/capabilities`, Commitment 7),
  **`snapshot.ts`** (`/system/snapshot` capture/restore, Commitment 8 — a dev/replay affordance,
  ADR-0009). `capabilities.ts` derives the capability payload from the operation registry.
- **`idempotency.ts`**: `withIdempotency`, the `Idempotency-Key` replay dance (Commitment 4) over
  `@qaroom/messaging/idempotency`. `db.ts` (`pgPoolMax` — a load-shedding bound), `env.ts`
  (`intFromEnv` — rejects blank/`""`), `runtime.ts` (`createProductionDeps` trio + `runServer`),
  `openapi.ts`/`asyncapi.ts`/`build-doc.ts` (doc emission).

## Conventions enforced here

- **DB-free by design.** service-kit carries no postgres/drizzle dependency, so the DB-less gateway
  reuses the same shell; readiness is an injected callback, never an imported DB module.
- **The determinism trio is wired here** (`createProductionDeps`: `SystemClock` / `UlidIdGenerator` /
  `CryptoRandomness`); tests inject the seeded doubles instead. **Production code must never import
  from testing-utils.** See "Conventions — the gate is the spec" in the repo-root `AGENTS.md`.

## Commands

```bash
pnpm --filter @qaroom/service-kit test       # vitest
pnpm --filter @qaroom/service-kit typecheck
pnpm --filter @qaroom/service-kit stryker    # mutation tier (one of the targeted modules)
```
