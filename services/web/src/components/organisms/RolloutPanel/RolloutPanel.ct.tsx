import { advanceRollout, theFlagState } from '@qaroom/testing-utils/screenplay'
import { createComponentActor } from '@qaroom/testing-utils/screenplay-ct'
import { composeStories } from '@storybook/react-vite'
import { expect, test } from '../../../../playwright'
import { mountStory } from '../../../test-support/mount-story'
import { RolloutPanel, type RolloutPanelProps } from './RolloutPanel'
import * as stories from './RolloutPanel.stories'

// THE canonical Milestone-8 component test (ADR-0005). It proves the one-vocabulary/two-runtime
// promise: the SAME Screenplay Tasks/Questions the E2E suite uses (advanceRollout / theFlagState)
// run here against a MOUNTED component via createComponentActor's InteractWithComponent binding —
// only the ability differs, the Task source is identical. Args are READ via composeStories;
// `mountStory` mounts the RAW component spread (a composeStories() result cannot be mounted — the
// no-mount-composed-story lint rule enforces this). Browser required.
const { OffState } = composeStories(stories)

test('a Screenplay actor reads the state and advances the rollout in component context', async ({
  mount,
}) => {
  const advanced: string[] = []
  const args: RolloutPanelProps = {
    ...(OffState.args as RolloutPanelProps),
    onAdvance: (event) => advanced.push(event),
  }
  const mounted = await mountStory(mount, RolloutPanel, args)
  const actor = createComponentActor(mounted, 'Dana')

  expect(await actor.asks(theFlagState())).toBe('Off')
  await actor.attemptsTo(advanceRollout('EnableRequested'))
  expect(advanced).toEqual(['EnableRequested'])

  // Visual regression (browser + `--update-snapshots` to seed the baseline; Milestone 8):
  // await expect(mounted.page()).toHaveScreenshot('rollout-panel-off.png', { animations: 'disabled' })
})
