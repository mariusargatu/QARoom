import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker (Milestone 8): the in-process (pglite, stub payment client)
// suites that cover the mutated repository. BOTH the property suites and the example-based
// donations.spec.ts (setupServiceTest harness — pglite + stub payment client, container-free) are
// included because each kills mutants the other leaves alive over the same modules; dropping either
// shrinks the killed set and can push the mutation score below thresholds.break. The consumer/Pact
// specs stay out (they need NATS/Testcontainers).
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
