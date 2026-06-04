import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker (Milestone 8): only the fast co-located unit tests that cover the
// mutated critical modules (lamport, ids). Excludes everything else so each surviving-mutant check
// re-runs a tiny, in-process suite — no Testcontainers/pglite. See packages/contracts/stryker.config.json.
export default defineConfig({
  test: {
    include: ['src/lamport.test.ts', 'src/ids.test.ts'],
  },
})
