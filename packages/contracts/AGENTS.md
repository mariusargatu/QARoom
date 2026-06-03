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

## Commands

```bash
pnpm --filter @qaroom/contracts test       # vitest (incl. param-pattern guard)
pnpm --filter @qaroom/contracts typecheck
```

Changing a schema? The blast radius is: this package → each service's `openapi.yaml` (regenerate)
→ the consumer Pact tests → the Pact↔OpenAPI cross-check. One commit, atomically (Commitment 16).
