import { defineConfig } from 'vitest/config'

// The orchestration tier's own test lane. `scripts/` is not a workspace package, so the per-package
// turbo sweep (and `test-results:generate`) never sees it. This config runs the `scripts/**/*.test.ts`
// files from the repo root, where the `@qaroom/*` workspace packages already resolve. Wired into
// `pnpm verify` via `pnpm test:scripts`.
//
// Coverage here is PARTIAL by design and grows case-by-case, the false-green guards that matter most
// first: today the fold-runner merge path, the tenant-span audit, and the census
// fail-on-recorded-failure branch. This is NOT a claim that every gate classifier under `scripts/` is
// unit-tested — most are exercised end-to-end by `pnpm verify` running them for real.
export default defineConfig({
  test: {
    globals: true,
    include: ['scripts/**/*.test.ts'],
  },
})
