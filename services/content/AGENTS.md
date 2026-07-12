# content-service

Posts and votes within communities. The Milestone 0 reference service: its shape is
the template every later service follows. Read the repo-root `AGENTS.md` first.

> **Layout note (2026-06-18):** content now uses a layered `src/` (folders by concern, below) and is
> the *new* reference shape. `identity`/`flags`/`donations`/`webhooks` still carry the older flat
> layout — converting them is unscheduled debt with no owner yet (there is no tracking artifact in
> this repo; do not infer one). When scaffolding a new service, copy content's structure regardless.

## Endpoints

| Method | Path | operationId | Notes |
|---|---|---|---|
| POST | `/api/communities/{communityId}/posts` | `createPost` | mutating; `Idempotency-Key` required; OAS `links`->getPost |
| GET | `/api/communities/{communityId}/feed` | `listCommunityFeed` | newest first; carries `as_of` |
| GET | `/api/posts/{postId}` | `getPost` | 404 -> RFC 7807 problem |
| POST | `/api/posts/{postId}/votes` | `castVote` | mutating; `Idempotency-Key` required; recomputes score |
| GET | `/system/state` | `getSystemState` | observable state + `as_of` (Commitment 7) |
| GET | `/system/capabilities` | `getSystemCapabilities` | MCP-tool-shaped (Commitment 7) |

## Where things live

`src/` is organized by concern:

| Folder | What |
|---|---|
| `routes/` | HTTP layer: `posts.ts` / `votes.ts` / `feed.ts` (`registerXRoutes`). Parse + brand params/body. |
| `repository/` | Data access by aggregate: `posts.ts` (create/get/listFeed), `votes.ts` (castVote), `counts.ts`. |
| `events/` | Outbox event construction: `post-created.ts`, `vote-cast.ts` (validated, staged inside the tx). |
| `contract/` | `operations.ts` (the operation registry) + `openapi-document.ts` / `asyncapi-document.ts`. |
| `config/` | `faults.ts`: the deliberate-bug seam (env → injectable `FaultConfig`, resolved once at boot). |
| `db/` | `schema.ts` (Drizzle) + `migrate.ts` + `backfill.ts` + `client.ts`. |
| `jobs/` | `gc-dedup.ts` (the shared GC cron shim). |
| root | `app.ts` (composition), `server.ts` (boot), `deps.ts` (injection types), `telemetry.ts`, `{openapi,asyncapi}-build.ts` (tsx entrypoints — kept at root so `writeDoc` resolves the doc to the service root). |

- **Schemas:** `@qaroom/contracts` (Zod is the source of truth). Never hand-edit `openapi.yaml`.
- **Operation registry:** `src/contract/operations.ts`: the single source feeding `openapi.yaml`,
  `/system/capabilities`, and the capabilities completeness test. Keep routes in lockstep with it.
- **Persistence:** `src/db/schema.ts` (Drizzle) + `src/db/migrate.ts` (idempotent DDL applied on boot/test).
- **Errors:** RFC 7807 Problem Details come from `@qaroom/service-kit` (`problem` + `withIdempotency`);
  every non-2xx is `application/problem+json` (Commitment 13). content has no problem-details module of its own.
- **Single-writer:** `src/repository/votes.ts` (and `posts.ts`): advisory lock + `FOR UPDATE`;
  replays from `idempotency_responses`.
- **Fault switches:** `src/config/faults.ts`: the four deliberate-bug env toggles, read once at the boot
  boundary and injected — never read from `process.env` inside handlers. Intentionally unguarded (see the file).

## Conventions enforced here

- All dependencies are injected (`db`, `clock`, `ids`, `randomness`); no globals (Commitment 6).
- IDs cross the HTTP boundary through branded Zod parsers; raw strings never reach business code.
- Mutations carry `Idempotency-Key` and declare OAS `links`.
- `community_id` is the tenancy discriminator from day one (Commitment 9 seam).

## Commands

```bash
pnpm --filter @qaroom/content dev               # tsx watch (needs Postgres: pnpm dev from root)
pnpm --filter @qaroom/content test              # vitest (unit + property + integration)
pnpm --filter @qaroom/content typecheck
pnpm --filter @qaroom/content openapi:generate  # regenerate openapi.yaml from Zod + operations
```

## Changing the contract

1. Edit the Zod schema in `@qaroom/contracts` and/or the operation in `src/contract/operations.ts`.
2. `pnpm --filter @qaroom/content openapi:generate`; commit `openapi.yaml` alongside the code.
3. CI re-generates and runs the round-trip + `oasdiff` gate: undeclared breaking changes fail the PR.
