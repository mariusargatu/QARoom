# flags-service

Per-community feature-flag resolution and rollout (Milestone 5). A flag's value is the current
state of a hand-authored XState rollout machine; the service advances it through explicit
events and publishes a flag-changed event on every transition. Read the repo-root `AGENTS.md`
first; this service follows the content-service template.

## Endpoints

| Method | Path | operationId | Notes |
|---|---|---|---|
| GET | `/api/communities/{communityId}/flags/{flagKey}` | `resolveFlag` | rollout `state` + gating `enabled`; carries `as_of` |
| GET | `/api/communities/{communityId}/flags` | `listFlags` | every resolved flag; carries `as_of` |
| POST | `/api/communities/{communityId}/flags/{flagKey}/rollout` | `advanceRollout` | mutating; `Idempotency-Key`; 409 on an illegal transition; OAS `links`->resolveFlag |
| GET | `/system/state` | `getSystemState` | observable state + `as_of` (Commitment 7) |
| GET | `/system/capabilities` | `getSystemCapabilities` | MCP-tool-shaped (Commitment 7) |

## Where things live

- **Rollout machine:** `@qaroom/contracts` `machines/rollout.machine.ts` (invoke-free, context-free)
  + `rollout.runner.ts` (`applyRolloutEvent`). The machine, not the handler, decides legality.
- **Schemas:** `@qaroom/contracts` (`FlagResolution`, `AdvanceRolloutRequest`, `FlagStateChangedEvent`).
- **Operation registry:** `src/contract/operations.ts`: single source feeding `openapi.yaml`, `/system/capabilities`, and the completeness test.
- **Persistence:** `src/db/schema.ts` (one row per `(community_id, flag_key)`) + `src/db/migrate.ts`.
- **Repository:** `src/repository.ts`: advisory lock + `FOR UPDATE`, transactional outbox, LamportGate bump.

## Conventions enforced here

- A rollout transition emits an always-sampled `xstate.transition` span (from/to/event) **after** commit: the reverse-conformance substrate (ADR-0012).
- The published `flag.state.changed` event uses the `subjects.ts` builder; `community_id` is at the fixed third subject position.
- Mutations carry `Idempotency-Key` and declare OAS `links`; `enabled` is derived only via `rolloutEnabled` (state === `Enabled`).

## Commands

```bash
pnpm --filter @qaroom/flags dev               # tsx watch (needs Postgres + NATS: pnpm dev from root)
pnpm --filter @qaroom/flags test              # vitest (unit + property + MBT conformance)
pnpm --filter @qaroom/flags typecheck
pnpm --filter @qaroom/flags openapi:generate  # regenerate openapi.yaml from Zod + operations
pnpm --filter @qaroom/flags asyncapi:generate # regenerate asyncapi.yaml
```

## Model-based testing

`tests/rollout.mbt.spec.ts` replays every shortest path through the rollout model
(`@qaroom/testing-utils/mbt`) against the live service; a broken transition fails exactly the
paths that cross it and names the divergent state. The model-validation guard asserts the
system's initial state and event surface match the model before any path runs.
