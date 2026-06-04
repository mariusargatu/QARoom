import { defineConfig } from 'vitest/config'

// Unit tests (api client, pure helpers), node env. This is `pnpm test` and what the root aggregator
// (scripts/aggregate-test-results.ts) runs via a bare `vitest run` — so it must stay browser-free.
// The headless Storybook browser suite lives in its own config (vitest.storybook.config.ts) so the
// aggregate never tries to launch Chromium. Component behaviour is covered there + by Playwright CT
// (ADR-0005), not by Vitest DOM rendering.
export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
