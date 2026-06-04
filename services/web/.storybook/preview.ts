import type { Preview } from '@storybook/react-vite'
import '../src/styles/globals.css'

// The semantic tokens load globally so every story renders in the real dark theme.
const preview: Preview = {
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true },
    // Run axe in the same headless addon-vitest pass and FAIL on a violation (Milestone 8): a11y
    // regressions surface as test failures, not console warnings. Scope per-story with parameters.a11y.
    a11y: { test: 'error' },
  },
}

export default preview
