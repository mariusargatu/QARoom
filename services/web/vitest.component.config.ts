import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Screenplay component tests (ADR-0027, supersedes the Playwright-CT tier of ADR-0005). Hand-written
// `*.browser.test.tsx` files render components with `vitest-browser-react`'s `render()` and drive
// them through the SAME Screenplay Tasks/Questions the E2E suite uses (one vocabulary, two runtimes —
// only the ability binding differs). Runs headlessly in real Chromium, the same engine as the
// Storybook suite, so there is ONE component runtime and ONE V8 coverage format (no V8+Istanbul
// merge). Kept separate from the node aggregate (`pnpm test`) so that stays browser-free. This is
// `pnpm test:component`. Visual regression uses Vitest's `toMatchScreenshot()` (options passed
// per-assertion); baselines are environment-named and generated in the CI container for parity.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    name: 'component',
    include: ['src/**/*.browser.test.tsx'],
    setupFiles: ['./vitest.component.setup.ts'],
    reporters: [['default'], ['json', { outputFile: 'test-results/component.json' }]],
    browser: {
      enabled: true,
      headless: true,
      // Don't litter __screenshots__ with on-failure captures (only the opt-in toMatchScreenshot
      // baseline is a tracked artifact); a failing assertion already names the locator.
      screenshotFailures: false,
      // `--no-sandbox`: Chromium runs as root in the pinned visual container (Dockerfile.visual);
      // harmless locally. The launch flag does not affect rendering, so baselines stay stable.
      provider: playwright({ launchOptions: { args: ['--no-sandbox'] } }),
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      provider: 'v8',
      reporter: ['json', 'json-summary', 'text'],
      reportsDirectory: 'coverage-component',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.stories.tsx',
        'src/**/*.browser.test.tsx',
        'src/**/*.test.{ts,tsx}',
        'src/**/index.ts',
        'src/test-support/**',
      ],
    },
  },
})
