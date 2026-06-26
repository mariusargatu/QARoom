import { configDefaults, defineConfig } from 'vitest/config'

// Unit tests (api client, pure helpers), node env. This is `pnpm test` and what the root aggregator
// (scripts/aggregate-test-results.ts) runs via a bare `vitest run` — so it must stay browser-free.
// The two headless browser suites live in their own configs so the aggregate never launches Chromium:
// stories (play() + a11y) in vitest.storybook.config.ts, Screenplay component tests in
// vitest.component.config.ts (ADR-0027). The browser tests are named `*.browser.test.tsx` and are
// excluded here so this node run never tries to render them.
export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'src/**/*.browser.test.tsx'],
    // `pnpm test:coverage` only (off for the bare aggregate run). The node unit tests (api/client,
    // http, lib, session/jwt, the flow machines) fold as the `coverage:web-node` V8 runner so their
    // coverage isn't under-counted by the browser-only story/component runs (ADR-0027).
    coverage: {
      provider: 'v8',
      reporter: ['json', 'json-summary', 'text'],
      reportsDirectory: 'coverage-node',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.stories.tsx',
        'src/**/*.browser.test.tsx',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.probe.tsx',
        'src/**/index.ts',
        'src/test-support/**',
      ],
    },
  },
})
