import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { IdentityPicker } from './IdentityPicker'

const meta = {
  title: 'organisms/IdentityPicker',
  component: IdentityPicker,
  // `fn()` makes the callbacks spies so a play() can assert them (Storybook resets them per story).
  args: { knownUsers: [], onSignIn: fn(), onSignUp: fn() },
} satisfies Meta<typeof IdentityPicker>

export default meta
type Story = StoryObj<typeof meta>

export const FirstRun: Story = {}
export const WithRecent: Story = {
  args: {
    knownUsers: [
      { id: 'user_01', handle: 'ada', display_name: 'Ada Lovelace' },
      { id: 'user_02', handle: 'grace', display_name: 'Grace Hopper' },
    ],
  },
}

// Headless interaction test (Milestone 8): picking a remembered identity signs that user in.
// Clicking Grace's identity row must fire `onSignIn` with her id — not Ada's, not the handle.
export const PickingRecentIdentitySignsThatUserIn: Story = {
  args: {
    knownUsers: [
      { id: 'user_01', handle: 'ada', display_name: 'Ada Lovelace' },
      { id: 'user_02', handle: 'grace', display_name: 'Grace Hopper' },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Grace Hopper/ }))
    await expect(args.onSignIn).toHaveBeenCalledWith('user_02')
  },
}
export const WithError: Story = { args: { error: 'Community slug already taken.' } }
