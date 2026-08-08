import * as a11yAddonAnnotations from '@storybook/addon-a11y/preview'
import { describe, expect, it } from 'vitest'
import preview from '../../.storybook/preview'

/**
 * Guards the wiring of the Storybook accessibility gate — not accessibility itself.
 *
 * `.storybook/main.ts` listing `@storybook/addon-a11y` registers the addon for the Storybook UI
 * only. The headless `addon-vitest` run composes its annotations from the CSF-factory preview
 * instead, so an addon absent from `definePreview({ addons: [...] })` contributes NOTHING to the
 * test run — its `afterEach` (the axe pass) is never installed. `parameters.a11y.test` then
 * configures a check that does not exist, and every story passes no matter what it renders.
 *
 * That is exactly what shipped: `definePreview({ addons: [] })` sat three lines above
 * `a11y: { test: 'error' }`, and the whole suite was green. Proven by mutation — a story rendering
 * an `<img>` with no alt and a `<button>` with no name (two axe *critical* violations) passed with
 * `addons: []` and failed with `addons: [addonA11y()]` on `image-alt`.
 *
 * Config alone is not evidence, so this asserts BOTH halves, and each fails on its own:
 *   1. the axe pass is actually installed in the composed annotations, and
 *   2. it is configured to FAIL a story rather than warn.
 *
 * Lives in the node project (`pnpm test`, i.e. `src/**\/*.test.ts`) deliberately: that is the only
 * frontend suite the required `verify` job runs on a PR. The browser tiers this gate protects
 * (`test:stories`, `test:component`) are nightly-only, so a guard placed there could not stop the
 * regression from merging again.
 */
describe('the Storybook accessibility gate', () => {
  const composed = (preview as unknown as { composed: Record<string, unknown> }).composed

  it('installs the addon’s axe pass, without which a11y parameters configure nothing', () => {
    const installed = (composed.afterEach ?? []) as unknown[]
    expect(installed).toContain(a11yAddonAnnotations.afterEach)
  })

  it('fails a story on a violation rather than reporting it as a warning', () => {
    const parameters = composed.parameters as { a11y?: { test?: string } }
    expect(parameters.a11y?.test).toBe('error')
  })
})
