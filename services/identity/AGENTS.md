# identity-service

Users, communities-as-tenants, memberships, sessions, and JWT/JWKS (Milestone 2). identity is
the **community registry**: the source of truth the `tenant_resolution` failure domain checks.
Read the repo-root `AGENTS.md` first, then `services/content/AGENTS.md` (the service template).

## Endpoints

| Method | Path | operationId | Notes |
|---|---|---|---|
| POST | `/api/users` | `createUser` | mutating; `Idempotency-Key` required; links->getUser |
| GET | `/api/users/{userId}` | `getUser` | 404 -> `not_found` |
| POST | `/api/communities` | `createCommunity` | mutating; 409 `conflict` on duplicate slug |
| POST | `/api/communities/{communityId}/members` | `addMembership` | mutating; 404 -> **`tenant_resolution`**; 409 `conflict` |
| GET | `/api/communities/{communityId}/members` | `listMembers` | carries `as_of`; 404 -> **`tenant_resolution`** |
| POST | `/api/sessions` | `createSession` | mutating; issues an ES256 access token |
| GET | `/jwks.json` | `getJwks` | public keys (root path, not under `/api` or `/system`) |
| GET | `/system/state` | `getSystemState` | counts + signing-key status (Commitment 7) |
| GET | `/system/capabilities` | `getSystemCapabilities` | MCP-tool-shaped (Commitment 7) |

## Where things live

- **Schemas:** `@qaroom/contracts` (`community.ts`, `user.ts`, `session.ts`). Never hand-edit `openapi.yaml`.
- **Operation registry:** `src/operations.ts`: single source feeding `openapi.yaml`, `/system/capabilities`, and the completeness test. Keep routes in lockstep.
- **Persistence + migration:** `src/db/schema.ts`; `src/db/migrate.ts` drives the reusable `MigrationMachine` (provision + seed the general community). Migration reversibility is tested in `migrations/0001-init.test.ts`.
- **Keys / JWT:** `src/keys.ts` (KeyStore + rotation + JWKS-eligibility) and `src/jwt.ts` (issue/verify). ES256; ADR-0008.
- **Errors:** every non-2xx is `application/problem+json` via `problem()` (Commitment 13).

## Conventions enforced here

- All dependencies injected (`db`, `clock`, `ids`, `randomness`, `keyMaterial`); no globals (Commitment 6).
- JWT `iat`/`exp` and the rotation grace window use **logical time** from the injected `Clock`, never `new Date`.
- Key material comes from the injected `KeyMaterialSource`; tests use a fixed committed ES256 keypair.
- The general community is a **reserved branded id** (`COMM_GENERAL`), slug `general` (ADR-0007).
- Mutations carry `Idempotency-Key`; replays from `idempotency_responses`. Single-writer via advisory lock.

## Commands

```bash
pnpm --filter @qaroom/identity dev               # tsx watch (needs Postgres on :5433)
pnpm --filter @qaroom/identity test              # vitest (unit + property + integration + migration)
pnpm --filter @qaroom/identity typecheck
pnpm --filter @qaroom/identity openapi:generate  # regenerate openapi.yaml from Zod + operations
pnpm pact:verify --provider identity             # JWKS provider verification (needs Docker)
```

## Limits (Milestone 2)

- No password/credential auth: JWT *issuance* is the tested surface, not login.
- Grace window: 24h production, 1h test config. Gateway JWT *enforcement* is deferred (it consumes JWKS only).
