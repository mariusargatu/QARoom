import { definePreview } from '@storybook/react-vite'
import '../src/styles/globals.css'

// The CSF-factory preview (ADR-0027 §4). Stories created via `preview.meta().story()` import this
// default export and inherit its annotations; classic CSF3 stories keep working unchanged. The
// semantic tokens load globally so every story renders in the real dark theme.
export default definePreview({
  addons: [],
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true },
    // Run axe in the same headless addon-vitest pass and FAIL on a violation: a11y regressions
    // surface as test failures, not console warnings. Scope per-story with parameters.a11y.
    a11y: { test: 'error' },
  },
})
