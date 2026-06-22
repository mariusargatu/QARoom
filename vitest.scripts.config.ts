import { defineConfig } from 'vitest/config'

// The orchestration tier's own test lane. `scripts/` is not a workspace package, so the per-package
// turbo sweep (and `test-results:generate`) never sees it — which left the honesty layer itself
// (the sole writer of the frozen summary.json, its false-green guard, and the gate classifiers)
// with zero tests. This config runs the orchestration test files from the repo root, where the
// `@qaroom/*` workspace packages already resolve. Wired into `pnpm verify` via `pnpm test:scripts`.
export default defineConfig({
  test: {
    globals: true,
    include: ['scripts/**/*.test.ts'],
  },
})
