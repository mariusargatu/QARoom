/// <reference types="@vitest/browser/matchers" />
import { advanceRollout, theFlagState } from '@qaroom/testing-utils/screenplay'
import { createComponentActor } from '@qaroom/testing-utils/screenplay-ct'
import fc from 'fast-check'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { OffState } from './RolloutPanel.stories'

// THE canonical component test (ADR-0027, supersedes the Playwright-CT proof of ADR-0005). It proves
// the one-vocabulary / two-runtime promise: the SAME Screenplay Tasks/Questions the E2E suite uses
// (advanceRollout / theFlagState) run here against a component rendered by vitest-browser-react, via
// createComponentActor's InteractWithComponent binding — only the ability differs, the Task source is
// identical. `OffState.Component` is the portable CSF-factory story (state pre-applied); the test
// overrides `onAdvance` to capture the dispatched event. Browser required (`pnpm test:component`).
test('a Screenplay actor reads the state and advances the rollout in component context', async () => {
  const advanced: string[] = []
  const screen = await render(
    <OffState.Component
      onAdvance={(event) => {
        advanced.push(event)
      }}
    />,
  )
  const actor = createComponentActor(screen, 'Dana')

  expect(await actor.asks(theFlagState())).toBe('Off')
  await actor.attemptsTo(advanceRollout('EnableRequested'))
  expect(advanced).toEqual(['EnableRequested'])
})

// Property over the `loading` prop: the loading spinner (role=status) is shown exactly when `loading`
// is set, and never otherwise. Closes the `loading` true branch the Screenplay test above leaves to
// its `false` default. A fixed seed keeps both cases deterministically exercised.
test('the loading spinner is shown exactly when loading is set', async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (loading) => {
      const screen = await render(<OffState.Component loading={loading} onAdvance={() => {}} />)
      const spinner = screen.getByRole('status', { name: 'Loading rollout' }).query()

      expect(spinner !== null).toBe(loading)

      await screen.unmount()
    }),
    { seed: 271_828, numRuns: 12 },
  )
})

// Pixel visual regression (ADR-0027 §3) — NOT a DOM-serialization snapshot, so it does not trip the
// `no-snapshot` ban. OPT-IN (`VITE_VISUAL=1`): pixel baselines are environment-named
// (`<browser>-<platform>`) and NOT portable across a developer's OS and the CI container (font
// anti-aliasing differs), so the canonical baseline must be generated and committed from ONE
// controlled env — the CI container — with `VITE_VISUAL=1 pnpm test:component --update`. Gated so
// the default suite stays green everywhere; flip it to a hard gate once the container baseline lands.
// (`process` is absent in the browser; the flag comes from Vite's `import.meta.env`.)
const VISUAL = (import.meta.env as Record<string, string | undefined>).VITE_VISUAL === '1'

test.runIf(VISUAL)('the rollout card matches its visual baseline in the Off state', async () => {
  const screen = await render(<OffState.Component />)
  await expect
    .element(screen.getByRole('region', { name: 'Donations rollout' }))
    .toMatchScreenshot('rollout-panel-off', {
      comparatorName: 'pixelmatch',
      comparatorOptions: { allowedMismatchedPixelRatio: 0.02 },
    })
})
