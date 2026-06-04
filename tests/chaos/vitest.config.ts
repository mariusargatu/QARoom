import { defineConfig } from 'vitest/config'

/**
 * The chaos test project (Milestone 6). Deliberately separate from the per-package unit suites:
 * these tests need a LIVE cluster with Chaos Mesh installed, so they run via `pnpm chaos:run`
 * (and the nightly CI tier), never as part of `pnpm test`. One experiment at a time —
 * `fileParallelism: false` — because the single-node k3d cluster can host only one fault safely.
 */
export default defineConfig({
  test: {
    include: ['tests/chaos/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    pool: 'forks',
    // Emit a JSON report too, so `scripts/chaos-results.ts` can fold a `chaos` runner into the
    // frozen test-results/summary.json envelope (via its extensible per-runner `output`).
    reporters: ['default', ['json', { outputFile: 'test-results/chaos.json' }]],
  },
})
