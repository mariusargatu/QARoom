import { defineConfig } from 'vitest/config'

// COVERAGE-ONLY config (ADR-0027). Runs all three suites — node unit, Screenplay component, Storybook
// — as Vitest `projects` in ONE pass so coverage is a single coherent map. This avoids the
// cross-transform merge artifact you get by stitching three separate `vitest run` reports together
// (statement/branch positions drift between the storybook-vite / component-vite / node transforms, so
// a stitched merge under-counts even fully-covered files — e.g. a 100%-statements machine reads 50%).
// `pnpm test` stays the bare node-only run (browser-free, for the root aggregate); this is a separate
// `pnpm coverage` lane. Coverage is governed HERE at the root, not by the per-project configs.
export default defineConfig({
  test: {
    // node (logic) + component (Screenplay browser) projects. The Storybook project is intentionally
    // NOT here: every component now has a `.browser.test.tsx` or is rendered by a page test, so the
    // component project already covers them — and the storybook V8 provider intermittently throws
    // ERR_INVALID_URL on `.storybook/preview.ts` under the merged run. Stories still run + gate via
    // `pnpm test:stories` (play() + a11y); they just don't contribute to this coverage number.
    projects: ['./vitest.config.ts', './vitest.component.config.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage-merged',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.stories.tsx',
        'src/**/*.browser.test.tsx',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.probe.tsx',
        'src/**/index.ts',
        'src/test-support/**',
        'src/vite-env.d.ts',
        // The ReactDOM bootstrap entry — `createRoot(#root).render(<App/>)`. Runs only in a real
        // browser tab against index.html, not meaningfully unit-testable; conventionally excluded.
        'src/main.tsx',
      ],
    },
  },
})
