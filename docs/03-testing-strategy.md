# Testing strategy — folded

> Folded in the Living-Documentation pass. The strategy now lives next to the code that proves it.

- **The honeycomb, the boundary map, triangulation, the cost tiers:** [`ARCHITECTURE.md`](../ARCHITECTURE.md) §3–§5.
- **The property-based-testing discipline** (numRuns budget, `withResource`, stateful PBT): [`packages/testing-utils/AGENTS.md`](../packages/testing-utils/AGENTS.md).
- **The evidence:** [`docs/detection-matrix.md`](detection-matrix.md) (catches vs misses), [`docs/claims.md`](claims.md) (falsifiable claims), [`docs/failure-modes.md`](failure-modes.md), and `pnpm gauntlet` ([`docs/gauntlet.md`](gauntlet.md)).
- **The SLOs:** in code — `packages/contracts/src/slos.ts`.
- **The boundary registry (source of truth):** [`scripts/lib/manifests/boundary-registry.ts`](../scripts/lib/manifests/boundary-registry.ts).
