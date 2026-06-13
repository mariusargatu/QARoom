import { defineConfig, devices } from '@playwright/test'

// End-to-end (system) tests. Paths are GENERATED from the XState rollout model and authored as
// Screenplay flows (ADR-0005). Requires the app + gateway + services running; authored to spec
// and run with `pnpm --filter @qaroom/web e2e` against a live stack.
export default defineConfig({
  testDir: './tests/e2e',
  // Emit a JSON report so `scripts/e2e-results.ts` folds pass/fail into the root summary.json
  // without re-running the suite (mirrors playwright-ct.config.ts). `list` keeps console output.
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:5173',
  },
})
