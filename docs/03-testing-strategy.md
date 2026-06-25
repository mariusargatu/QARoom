# Testing strategy — folded

> Folded in the Living-Documentation pass. The strategy now lives next to the code that proves it.

- **The honeycomb, the boundary map, triangulation, the cost tiers:** [`ARCHITECTURE.md`](../ARCHITECTURE.md) §3–§5.
- **The property-based-testing discipline** (numRuns budget, `withResource`, stateful PBT): [`packages/testing-utils/AGENTS.md`](../packages/testing-utils/AGENTS.md).
- **The evidence:** [`docs/detection-matrix.md`](detection-matrix.md) (catches vs misses), [`docs/claims.md`](claims.md) (falsifiable claims), [`docs/failure-modes.md`](failure-modes.md), and `pnpm gauntlet` ([`docs/gauntlet.md`](gauntlet.md)).
- **The SLOs:** in code — `packages/contracts/src/slos.ts`.
- **The boundary registry (source of truth):** [`scripts/lib/manifests/boundary-registry.ts`](../scripts/lib/manifests/boundary-registry.ts).

**Where the old section numbers went** (for legacy `docs/03 §N` citations still in the code): **§3–§6** (honeycomb, boundary map, triangulation, cost tiers) → [`ARCHITECTURE.md`](../ARCHITECTURE.md) §3–§5 · **§8** (load / SLO budget) → `packages/contracts/src/slos.ts` + [`docs/slos.md`](slos.md), lanes in `.github/workflows/ci.yml` · **§11** (locked critical-modules list + its governance) → [ADR-0016](adr/0016-testing-your-tests.md).
