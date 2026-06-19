import { defineConfig } from 'vitest/config'

// Scoped Vitest config for Stryker (Milestone 8): the suites covering the mutated modules — the
// rate-limit token bucket (rate-limiter.ts) and the circuit-breaker signal mapping
// (breaker-guarded-call.ts, added to §11 in ADR-0016's 2026-06-19 addendum). BOTH the rate-limit
// property suite and its example-based integration spec are included so per-killer attribution
// (scripts/stryker-attribution.ts) can compare techniques over the same mutants — rate-limit.spec.ts
// is harness-injected stubs, fully in-process, so the old "Testcontainers specs under tests/"
// exclusion never actually applied to it. breaker-guarded-call.test.ts is its unit guard (the full
// 3-way signal table + transport + open-circuit). The Pact and proxy specs stay out.
export default defineConfig({
  test: {
    include: [
      'src/rate-limiter.property.test.ts',
      'tests/rate-limit.spec.ts',
      'src/breaker-guarded-call.test.ts',
    ],
  },
})
