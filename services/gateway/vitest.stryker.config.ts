import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker (Milestone 8): only the fast property suite covering the mutated
// rate-limit token bucket (rate-limiter.ts). Excludes the Testcontainers/Pact specs under tests/.
// See services/gateway/stryker.config.json.
export default defineConfig({
  test: {
    include: ['src/rate-limiter.property.test.ts'],
  },
})
