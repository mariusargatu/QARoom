import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker (Milestone 8): the in-process (pglite, stub payment client)
// property suites that cover donation gating + idempotency. Excludes the Pact/consumer specs under
// tests/ that need NATS/Testcontainers. See services/donations/stryker.config.json.
export default defineConfig({
  test: {
    include: ['src/gating.property.test.ts', 'src/idempotency.property.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
