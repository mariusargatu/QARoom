import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { PostComposer } from './PostComposer'

const meta = {
  title: 'organisms/PostComposer',
  component: PostComposer,
  // `fn()` makes onSubmit a spy so the play() can assert it was called (Storybook resets it per story).
  args: { onSubmit: fn() },
} satisfies Meta<typeof PostComposer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Pending: Story = { args: { pending: true } }
export const WithError: Story = { args: { error: 'content-service is unreachable.' } }

// Headless interaction test (Milestone 8): typing a title + body and clicking Post submits the
// trimmed title and body exactly once. Mirrors the RolloutStepper play() pattern (ADR-0005).
export const SubmitsTrimmedTitleAndBody: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByPlaceholderText('An interesting title'), '  My great post  ')
    await userEvent.type(canvas.getByPlaceholderText('Share your thoughts…'), 'The body copy.')
    await userEvent.click(canvas.getByRole('button', { name: 'Post' }))
    await expect(args.onSubmit).toHaveBeenCalledTimes(1)
    await expect(args.onSubmit).toHaveBeenCalledWith({
      title: 'My great post',
      body: 'The body copy.',
    })
  },
}

// The submit control is disabled while the title is empty: there is no post to send.
export const SubmitDisabledWithEmptyTitle: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Post' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Post' }))
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}
