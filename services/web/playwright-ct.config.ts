import { defineConfig, devices } from '@playwright/experimental-ct-react'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import istanbul from 'vite-plugin-istanbul'

// Playwright Component Tests (ADR-0005). Components mount in real Chromium compiled by Vite,
// wrapped in ThemeProvider + tokens (playwright/index.tsx). `@vitejs/plugin-react` is MANDATORY
// — without it the mounted TSX won't compile. Istanbul is appended only under COVERAGE=true so
// CT contributes to the unified V8+Istanbul coverage report (Milestone 8). Browser required:
// run with `pnpm --filter @qaroom/web ct` where `npx playwright install chromium` has run.
const COVERAGE = process.env.COVERAGE === 'true'

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.ct.tsx',
  snapshotDir: './.snapshots',
  // Stable, platform-suffix-free baseline layout; pin CT to a container to keep it portable.
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',
  use: {
    ...devices['Desktop Chrome'],
    ctTemplateDir: './playwright',
    ctViteConfig: {
      plugins: [
        react(),
        tailwindcss(),
        ...(COVERAGE
          ? [
              istanbul({
                include: 'src/**/*.{ts,tsx}',
                requireEnv: false,
                forceBuildInstrument: true,
              }),
            ]
          : []),
      ],
    },
  },
})
