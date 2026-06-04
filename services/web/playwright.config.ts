import { defineConfig, devices } from '@playwright/test'

// End-to-end (system) tests. Paths are GENERATED from the XState rollout model and authored as
// Screenplay flows (ADR-0005). Requires the app + gateway + services running; authored to spec
// and run with `pnpm --filter @qaroom/web e2e` against a live stack.
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:5173',
  },
})
