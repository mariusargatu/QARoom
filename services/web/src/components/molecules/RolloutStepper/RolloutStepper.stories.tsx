import { TESTID } from '@qaroom/testing-utils/testids'
import { expect, fn, userEvent, within } from 'storybook/test'
import preview from '../../../../.storybook/preview'
import { RolloutStepper } from './RolloutStepper'

// CSF Factory format (ADR-0027 §4). Molecule tier — current rollout state + a button per legal next
// event, over the Badge + Button atoms (already proven); these stories cover only its own composition.
const meta = preview.meta({
  title: 'molecules/RolloutStepper',
  component: RolloutStepper,
  // `fn()` makes onAdvance a spy so the play() can assert it was called (Storybook resets it per story).
  args: { onAdvance: fn() },
})

// Example headless interaction test (Milestone 8): the `play()` runs in the Storybook UI today
// and headlessly via `@storybook/addon-vitest` once a browser is wired (ADR-0005). It shows the
// current state and that clicking the advance control fires `onAdvance` with the modeled event.
export const Off = meta.story({
  args: { state: 'Off', legalEvents: ['EnableRequested'] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId(TESTID.rolloutState)).toHaveTextContent('Off')
    await userEvent.click(canvas.getByTestId(TESTID.rolloutAdvance('EnableRequested')))
    await expect(args.onAdvance).toHaveBeenCalledWith('EnableRequested')
  },
})
export const Enabling = meta.story({
  args: { state: 'Enabling', legalEvents: ['CanaryConfirmed', 'RolloutAborted'] },
})
export const Enabled = meta.story({ args: { state: 'Enabled', legalEvents: ['DisableRequested'] } })
export const Pending = meta.story({
  args: { state: 'Enabling', legalEvents: ['CanaryConfirmed', 'RolloutAborted'], pending: true },
})
