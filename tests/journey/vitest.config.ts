import { defineConfig } from 'vitest/config'

/**
 * The golden-journey project. Like the chaos project, it needs a LIVE k3d cluster (plus Jaeger),
 * so it runs via `pnpm journey:run` — never as part of `pnpm test`. One journey at a time
 * (`fileParallelism: false`): it creates real tenants/posts and reads the shared Jaeger trace
 * store, so concurrent journeys would cross-contaminate the span commitment. Emits a JSON report
 * so `scripts/journey-results.ts` can fold a `journey` runner into test-results/summary.json.
 */
export default defineConfig({
  test: {
    include: ['tests/journey/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    pool: 'forks',
    reporters: ['default', ['json', { outputFile: 'test-results/journey.json' }]],
  },
})
