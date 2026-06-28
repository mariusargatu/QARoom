# Recipe: add a field

A mechanical checklist for the most common change — adding a field to a request/response/event. It runs
the **spec-derived mass** (the part an agent should absorb) and **stops at the judgment review** (the part
no generator can do). This is the versioned companion to the gradient in
[getting-started.md](getting-started.md); it is a doc, not a local `.claude/` skill, so it ships with the
repo and the gates check its links.

> **Scope.** This recipe is for *additive* fields. A required field, a removed field, or a changed type is
> a **breaking change** — `pnpm openapi:verify` / `pnpm asyncapi:verify` will red and route you to the
> versioning path (a `*.v2` event, a frozen `openapi.v*.yaml`). That red is the contract working, not a
> blocker to silence.

## The mechanical mass (run, don't hand-author)

1. **Edit the ONE source.** Add the field to the Zod schema in
   [`packages/contracts/`](../packages/contracts/) — e.g. a donation field in
   [`src/donation.ts`](../packages/contracts/src/donation.ts), an event field in
   `packages/contracts/src/events/`. Make it `.optional()` unless you mean to break the contract. Do **not**
   edit the generated `openapi.yaml` / `asyncapi.yaml` by hand — that desync is exactly what the
   `agent-cannot-silently-desync` claim catches.

2. **Regenerate the contracts.**
   ```bash
   pnpm openapi:generate     # Zod -> services/*/openapi.yaml
   pnpm asyncapi:generate    # event schemas -> services/*/asyncapi.yaml (only if you touched an event)
   ```

3. **Gate the regeneration.**
   ```bash
   pnpm openapi:verify       # committed spec == generated; oasdiff classifies the change
   pnpm asyncapi:verify      # the AsyncAPI drift gate (ADR-0002), if you touched an event
   ```
   An optional field passes as non-breaking. Commit the regenerated spec(s) in the *same* change as the
   schema edit.

4. **Scaffold the property + contract stubs** (do not re-invent structure):
   - **Property:** the field is already in the contract type, so the shared generators in
     [`packages/testing-utils/src/generators`](../packages/testing-utils/src/generators) emit it for free.
     Add a `*.property.test.ts` assertion only if the field carries an *invariant* (a bound, a
     relationship) — and if it does, derive the bound from one constant (the `VOTE_VALUES` lesson), never
     restate it.
   - **Pact:** if a caller sends the field, add the interaction in the consumer's
     `services/<consumer>/tests/contracts/` and let provider verification confirm it
     (root [AGENTS.md](../AGENTS.md) → "How to make changes", step 5).

5. **Persist it** (if it is stored): add the column in the service's migration and repository. The schema
   is the source; the DB constraint should *derive* from it where a constraint exists (the
   single-source-invariant discipline, [ADR-0024](adr/0024-verifiable-invariants-single-source-enforced-at-the-boundary.md)).

## STOP — the judgment review (yours, not the recipe's)

The generators got you a legal field. They did **not** decide:

- **The oracle.** The right behaviour, the edge cases (absent vs empty), where the field surfaces. Write
  the assertion that pins *your* conjecture — that is testing; the rest was checking
  ([ADR-0030](adr/0030-checking-architecture-in-service-of-a-testing-mission.md)).
- **The threat model.** Is the value attacker-controlled? Does it reach a model prompt (fence it as data),
  a span (no PII), a webhook (signed, SSRF-guarded)? Pick the boundary, pick the oracle's rung on the
  independence ladder, and defend it deliberately.

## Final gate

```bash
pnpm verify    # lint + typecheck + every in-process drift gate (census, links, stats, claims, ...)
```

Green here means: the derived artifacts agree with the source, the docs did not drift, and your
hand-authored oracle is the only judgment in the change — which is exactly where it should be.
