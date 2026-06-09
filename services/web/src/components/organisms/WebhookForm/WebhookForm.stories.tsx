import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { WebhookForm } from './WebhookForm'

const meta = {
  title: 'organisms/WebhookForm',
  component: WebhookForm,
  // `fn()` makes onSubmit a spy so the play() can assert it was called (Storybook resets it per story).
  args: { onSubmit: fn() },
} satisfies Meta<typeof WebhookForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithError: Story = {
  args: { error: 'must be a public https URL (no loopback/private hosts)' },
}

// Headless interaction test (Milestone 8): submit requires a URL AND at least one event type, so
// the play() fills the delivery URL, selects one event-type checkbox, registers, then asserts the
// modeled `{ url, event_types }` payload reached `onSubmit` (ADR-0005).
export const RegistersWithUrlAndSelectedEvent: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const url = 'https://hooks.example.com/qaroom'
    await userEvent.type(canvas.getByPlaceholderText(url), url)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'post.created' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Register webhook' }))
    await expect(args.onSubmit).toHaveBeenCalledWith({
      url,
      event_types: ['post.created'],
    })
  },
}
