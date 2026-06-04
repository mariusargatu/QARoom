import type { StorybookConfig } from '@storybook/react-vite'

// Storybook 9 is ESM-only (this file must be ESM). Stories are the source of truth fanned
// across the test pyramid (ADR-0005): autodocs + addon-a11y here, headless `play()` via
// addon-vitest (Milestone 8 — browser-required; see .storybook/vitest.setup.ts), Playwright CT
// elsewhere.
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
}

export default config
