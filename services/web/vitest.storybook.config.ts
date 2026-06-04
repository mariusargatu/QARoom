import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Storybook portable-stories suite (Milestone 8, ADR-0005): every story's `play()` + addon-a11y run
// headlessly in real Chromium via @storybook/addon-vitest. Kept in a SEPARATE config from the unit
// suite so the browser-free aggregate (`vitest run`) never launches Chromium — this is `pnpm
// test:stories` / `test:stories:coverage`. Vitest 4: `provider` is the `playwright()` function (not
// the string), and `coverage.include` is mandatory (the default reports only covered files).
export default defineConfig({
  plugins: [react(), tailwindcss(), storybookTest({ configDir: '.storybook' })],
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      provider: 'v8',
      reporter: ['json', 'text'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.stories.tsx',
        'src/**/*.ct.tsx',
        'src/**/*.test.{ts,tsx}',
        'src/**/index.ts',
        'src/test-support/**',
      ],
    },
  },
})
