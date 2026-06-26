import { defineMain } from '@storybook/react-vite/node'

// Storybook 10 is ESM-only (this file must be ESM — no __dirname/require). Stories are the source of
// truth fanned across the test pyramid (ADR-0005, ADR-0027): autodocs + addon-a11y here, headless
// `play()` via addon-vitest (the portable-stories Vitest runner auto-injects its own setup, so there
// is no .storybook/vitest.setup.ts), and Screenplay component tests via vitest-browser-react.
// `defineMain` is the CSF-factory typed config entry (ADR-0027 §4); classic CSF3 stories keep working.
export default defineMain({
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
  core: { disableTelemetry: true },
})
