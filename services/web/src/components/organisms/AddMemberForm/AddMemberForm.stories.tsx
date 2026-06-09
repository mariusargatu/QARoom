import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AddMemberForm } from './AddMemberForm'

const meta = {
  title: 'organisms/AddMemberForm',
  component: AddMemberForm,
  // `fn()` makes onSubmit a spy so the play() can assert it was called (Storybook resets it per story).
  args: { onSubmit: fn() },
} satisfies Meta<typeof AddMemberForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithError: Story = { args: { error: 'User is already a member.' } }

// Headless interaction test (Milestone 8): typing a user id, picking a non-default role, and
// submitting fires `onSubmit` with the trimmed `{ user_id, role }` the form models.
export const SubmitsTypedUserAndPickedRole: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByPlaceholderText('user_…'), 'user_42')
    await userEvent.selectOptions(canvas.getByRole('combobox'), 'moderator')
    await userEvent.click(canvas.getByRole('button', { name: 'Add member' }))
    await expect(args.onSubmit).toHaveBeenCalledWith({ user_id: 'user_42', role: 'moderator' })
  },
}
