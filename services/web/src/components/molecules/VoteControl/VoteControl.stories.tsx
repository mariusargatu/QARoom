import { expect, fn, userEvent, within } from 'storybook/test'
import preview from '../../../../.storybook/preview'
import { VoteControl } from './VoteControl'

// CSF Factory format (ADR-0027 §4). Molecule tier — the up/score/down control over the IconButton atom
// (already proven); these stories cover only its own composition (vote highlighting + the onVote wiring).
const meta = preview.meta({
  title: 'molecules/VoteControl',
  component: VoteControl,
  // `fn()` makes onVote a spy so the play() can assert it was called (Storybook resets it per story).
  args: { score: 142, onVote: fn() },
})

export const Neutral = meta.story({})

// Clicking the upvote control fires `onVote(1)`. The buttons are icon-only, addressed by their
// accessible name (IconButton turns `label` into aria-label, enforced by the a11y gate).
export const UpvoteFiresPositiveOne = meta.story({
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Upvote' }))
    await expect(args.onVote).toHaveBeenCalledWith(1)
  },
})

// Clicking the downvote control fires `onVote(-1)`.
export const DownvoteFiresNegativeOne = meta.story({
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Downvote' }))
    await expect(args.onVote).toHaveBeenCalledWith(-1)
  },
})

export const Upvoted = meta.story({ args: { value: 1, score: 143 } })
export const Downvoted = meta.story({ args: { value: -1, score: 141 } })
export const Horizontal = meta.story({ args: { orientation: 'horizontal' } })
export const Pending = meta.story({ args: { pending: true } })
