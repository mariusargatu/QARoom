import { defineConfig, devices } from '@playwright/test'

// End-to-end (system) tests. Paths are GENERATED from the XState rollout model and authored as
// Screenplay flows (ADR-0005). Requires the app + gateway + services running; authored to spec
// and run with `pnpm --filter @qaroom/web e2e` against a live stack.
// Two ways to run, and before this there was only the first — which meant that outside a live k3d
// cluster the suite had no way to start at all, and the gauntlet step that drives it skips itself
// whenever the cluster is absent. So the model-based E2E tests could sit broken indefinitely with
// nothing to notice.
//
//   WEB_BASE_URL set   → run against that origin as-is (the gauntlet points it at the ingress,
//                        http://qaroom.localhost, where /api and /ws already route to the gateway).
//   WEB_BASE_URL unset → Playwright starts the Vite dev server itself; its proxy (vite.config.ts)
//                        forwards /api and /ws to QAROOM_GATEWAY_URL, so a developer with the stack
//                        up can run `pnpm --filter @qaroom/web e2e` with no extra setup.
const externalBaseUrl = process.env.WEB_BASE_URL

export default defineConfig({
  testDir: './tests/e2e',
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: 'pnpm exec vite --port 5173 --strictPort',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
  // Emit a JSON report so `scripts/e2e-results.ts` folds pass/fail into the root summary.json
  // without re-running the suite (mirrors playwright-ct.config.ts). `list` keeps console output.
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:5173',
  },
})
