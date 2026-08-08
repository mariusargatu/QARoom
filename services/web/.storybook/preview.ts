import addonA11y from '@storybook/addon-a11y'
import { definePreview } from '@storybook/react-vite'
import '../src/styles/globals.css'

// The CSF-factory preview (ADR-0027 §4). Stories created via `preview.meta().story()` import this
// default export and inherit its annotations; classic CSF3 stories keep working unchanged. The
// semantic tokens load globally so every story renders in the real dark theme.
export default definePreview({
  // LOAD BEARING, not a formality: main.ts's `addons` list registers addons for the Storybook UI,
  // but the headless addon-vitest run composes its annotations from THIS preview. An addon missing
  // here contributes nothing to the test run, so `parameters.a11y` below would configure a check
  // that is never installed and every story would pass whatever it renders — which is exactly what
  // an empty array here shipped. Guarded by src/test-support/storybook-a11y-gate.test.ts.
  addons: [addonA11y()],
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true },
    // Run axe in the same headless addon-vitest pass and FAIL on a violation: a11y regressions
    // surface as test failures, not console warnings. Scope per-story with parameters.a11y.
    a11y: { test: 'error' },
  },
})
