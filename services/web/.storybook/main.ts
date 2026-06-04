import type { StorybookConfig } from '@storybook/react-vite'

// Storybook 10 is ESM-only (this file must be ESM — no __dirname/require). Stories are the source
// of truth fanned across the test pyramid (ADR-0005): autodocs + addon-a11y here, headless `play()`
// via addon-vitest (Milestone 8 — the portable-stories Vitest runner auto-injects its own setup, so
// there is no .storybook/vitest.setup.ts), Playwright CT elsewhere.
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
  core: { disableTelemetry: true },
}

export default config
