import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker (Milestone 8): only the fast unit suite covering the mutated
// RFC 7807 envelope (problem.ts). No Testcontainers/pglite. See packages/service-kit/stryker.config.json.
export default defineConfig({
  test: {
    include: ['src/service-kit.test.ts'],
  },
})
