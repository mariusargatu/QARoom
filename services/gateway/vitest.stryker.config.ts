import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker (Milestone 8): the suites covering the mutated rate-limit
// token bucket (rate-limiter.ts). BOTH the property suite and the example-based integration spec
// are included so per-killer attribution (scripts/stryker-attribution.ts) can compare techniques
// over the same mutants — rate-limit.spec.ts is harness-injected stubs, fully in-process, so the
// old "Testcontainers specs under tests/" exclusion never actually applied to it. The Pact and
// proxy specs stay out (they don't touch the mutated module).
export default defineConfig({
  test: {
    include: ['src/rate-limiter.property.test.ts', 'tests/rate-limit.spec.ts'],
  },
})
