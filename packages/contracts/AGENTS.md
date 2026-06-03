# contracts

The schema authority. Zod schemas here are the **single source of truth**; OpenAPI (and later
AsyncAPI + XState machines) are generated from them. Read the repo-root `AGENTS.md` first.

## Rules

- **Zod is the source of truth.** Never hand-edit a generated `openapi.yaml` — change the Zod
  schema, then run `openapi:generate` in each consuming service. CI's `oasdiff` gate blocks
  undeclared breaking changes.
- **Branded IDs go through `ids.ts`.** The ULID pattern lives once in `brandedIdPattern`; the
  runtime parser and the OpenAPI path-param schema both derive from it (`openapi/params.test.ts`
  pins them equal). Do not re-hardcode the pattern anywhere.
- **`test-results-schema.ts` is FROZEN** (do-not-touch). Changing the `summary.json` schema
  requires a superseding ADR.
- Every schema that crosses a process boundary carries `.meta({ id })` so it lands in the OAS
  `components` and the round-trip property test (`generators/roundtrip.property.test.ts`) covers it.
- **`src/machines/` hosts hand-authored XState machines** (the contract for both production and
  tests). They MUST stay **invoke-free and context-free** — `@xstate/graph` (Milestone 5) rejects
  `invoke`/`after` and any `context` explodes its BFS. I/O lives in a runner (`runMigration`), never
  in the machine. A guard test pins the constraint.

## Commands

```bash
pnpm --filter @qaroom/contracts test       # vitest (incl. param-pattern guard)
pnpm --filter @qaroom/contracts typecheck
```

Changing a schema? The blast radius is: this package → each service's `openapi.yaml` (regenerate)
→ the consumer Pact tests → the Pact↔OpenAPI cross-check. One commit, atomically (Commitment 16).
