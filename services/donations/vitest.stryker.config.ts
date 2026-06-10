import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker (Milestone 8): the in-process (pglite, stub payment client)
// suites that cover the mutated repository. BOTH the property suites and the example-based
// donations.spec.ts (setupServiceTest harness — pglite + stub payment client, container-free) are
// included so per-killer attribution (scripts/stryker-attribution.ts) can compare techniques over
// the same mutants. The consumer/Pact specs stay out (they need NATS/Testcontainers).
export default defineConfig({
  test: {
    include: [
      'src/gating.property.test.ts',
      'src/idempotency.property.test.ts',
      'tests/donations.spec.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
