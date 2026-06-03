# content-service

Posts and votes within communities. The Milestone 0 reference service — its shape is
the template every later service follows. Read the repo-root `AGENTS.md` first.

## Endpoints

| Method | Path | operationId | Notes |
|---|---|---|---|
| POST | `/api/communities/{communityId}/posts` | `createPost` | mutating; `Idempotency-Key` required; OAS `links`→getPost |
| GET | `/api/communities/{communityId}/feed` | `listCommunityFeed` | newest first; carries `as_of` |
| GET | `/api/posts/{postId}` | `getPost` | 404 → RFC 7807 problem |
| POST | `/api/posts/{postId}/votes` | `castVote` | mutating; `Idempotency-Key` required; recomputes score |
| GET | `/system/state` | `getSystemState` | observable state + `as_of` (Commitment 7) |
| GET | `/system/capabilities` | `getSystemCapabilities` | MCP-tool-shaped (Commitment 7) |

## Where things live

- **Schemas:** `@qaroom/contracts` (Zod is the source of truth). Never hand-edit `openapi.yaml`.
- **Operation registry:** `src/operations.ts` — the single source feeding `openapi.yaml`,
  `/system/capabilities`, and the capabilities completeness test. Keep routes in lockstep with it.
- **Persistence:** `src/db/schema.ts` (Drizzle) + `src/db/migrate.ts` (idempotent DDL applied on boot/test).
- **Errors:** `src/problem-details.ts` — every non-2xx is `application/problem+json` (Commitment 13).
- **Single-writer:** `src/repository.ts` — advisory lock + `FOR UPDATE`; replays from `idempotency_responses`.

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

1. Edit the Zod schema in `@qaroom/contracts` and/or the operation in `src/operations.ts`.
2. `pnpm --filter @qaroom/content openapi:generate`; commit `openapi.yaml` alongside the code.
3. CI re-generates and runs the round-trip + `oasdiff` gate — undeclared breaking changes fail the PR.

## Limits (Milestone 0)

- Tests run on embedded pglite; true concurrent-writer serialization tests land in Milestone 1 (Testcontainers).
- No comments, no communities service yet, no auth. Those arrive in later milestones.
