import { expect, fn, userEvent, within } from 'storybook/test'
import preview from '../../../../.storybook/preview'
import { PostComposer } from './PostComposer'

// CSF Factory format (ADR-0027 §4). Organism tier — the default/pending/error states of the post
// composer plus its two submit interactions; the Input/Textarea/Button atoms and FormField molecule
// inside are already proven, so these stories test only the composer's own composition.
const meta = preview.meta({
  title: 'organisms/PostComposer',
  component: PostComposer,
  // `fn()` makes onSubmit a spy so the play() can assert it was called (Storybook resets it per story).
  args: { onSubmit: fn() },
})

export const Default = meta.story({})
export const Pending = meta.story({ args: { pending: true } })
export const WithError = meta.story({ args: { error: 'content-service is unreachable.' } })

// Headless interaction test (Milestone 8): typing a title + body and clicking Post submits the
// trimmed title and body exactly once. Mirrors the RolloutStepper play() pattern (ADR-0005).
export const SubmitsTrimmedTitleAndBody = meta.story({
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
})

// The submit control is disabled while the title is empty: there is no post to send.
export const SubmitDisabledWithEmptyTitle = meta.story({
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Post' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Post' }))
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
})
