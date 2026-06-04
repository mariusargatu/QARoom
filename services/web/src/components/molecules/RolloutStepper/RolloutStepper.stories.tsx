import { TESTID } from '@qaroom/testing-utils/testids'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { RolloutStepper } from './RolloutStepper'

const meta = {
  title: 'molecules/RolloutStepper',
  component: RolloutStepper,
  // `fn()` makes onAdvance a spy so the play() can assert it was called (Storybook resets it per story).
  args: { onAdvance: fn() },
} satisfies Meta<typeof RolloutStepper>

export default meta
type Story = StoryObj<typeof meta>

// Example headless interaction test (Milestone 8): the `play()` runs in the Storybook UI today
// and headlessly via `@storybook/addon-vitest` once a browser is wired (ADR-0005). It shows the
// current state and that clicking the advance control fires `onAdvance` with the modeled event.
export const Off: Story = {
  args: { state: 'Off', legalEvents: ['EnableRequested'] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId(TESTID.rolloutState)).toHaveTextContent('Off')
    await userEvent.click(canvas.getByTestId(TESTID.rolloutAdvance('EnableRequested')))
    await expect(args.onAdvance).toHaveBeenCalledWith('EnableRequested')
  },
}
export const Enabling: Story = {
  args: { state: 'Enabling', legalEvents: ['CanaryConfirmed', 'RolloutAborted'] },
}
export const Enabled: Story = { args: { state: 'Enabled', legalEvents: ['DisableRequested'] } }
export const Pending: Story = {
  args: { state: 'Enabling', legalEvents: ['CanaryConfirmed', 'RolloutAborted'], pending: true },
}
