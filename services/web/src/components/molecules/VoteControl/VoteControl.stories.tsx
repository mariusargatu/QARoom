import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { VoteControl } from './VoteControl'

const meta = {
  title: 'molecules/VoteControl',
  component: VoteControl,
  // `fn()` makes onVote a spy so the play() can assert it was called (Storybook resets it per story).
  args: { score: 142, onVote: fn() },
} satisfies Meta<typeof VoteControl>

export default meta
type Story = StoryObj<typeof meta>

export const Neutral: Story = {}

// Clicking the upvote control fires `onVote(1)`. The buttons are icon-only, addressed by their
// accessible name (IconButton turns `label` into aria-label, enforced by the a11y gate).
export const UpvoteFiresPositiveOne: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Upvote' }))
    await expect(args.onVote).toHaveBeenCalledWith(1)
  },
}

// Clicking the downvote control fires `onVote(-1)`.
export const DownvoteFiresNegativeOne: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Downvote' }))
    await expect(args.onVote).toHaveBeenCalledWith(-1)
  },
}

export const Upvoted: Story = { args: { value: 1, score: 143 } }
export const Downvoted: Story = { args: { value: -1, score: 141 } }
export const Horizontal: Story = { args: { orientation: 'horizontal' } }
export const Pending: Story = { args: { pending: true } }
