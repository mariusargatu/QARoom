import { expect, fn, userEvent, within } from 'storybook/test'
import preview from '../../../../.storybook/preview'
import { AddMemberForm } from './AddMemberForm'

// CSF Factory format (ADR-0027 §4). Organism tier — the add-member form's default/error states and
// its submit interaction; the Input/Select/Button atoms and FormField molecule inside are already
// proven, so these stories test only the form's own composition (the trimmed `{ user_id, role }`).
const meta = preview.meta({
  title: 'organisms/AddMemberForm',
  component: AddMemberForm,
  // `fn()` makes onSubmit a spy so the play() can assert it was called (Storybook resets it per story).
  args: { onSubmit: fn() },
})

export const Default = meta.story({})
export const WithError = meta.story({ args: { error: 'User is already a member.' } })

// Headless interaction test (Milestone 8): typing a user id, picking a non-default role, and
// submitting fires `onSubmit` with the trimmed `{ user_id, role }` the form models.
export const SubmitsTypedUserAndPickedRole = meta.story({
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByPlaceholderText('user_…'), 'user_42')
    await userEvent.selectOptions(canvas.getByRole('combobox'), 'moderator')
    await userEvent.click(canvas.getByRole('button', { name: 'Add member' }))
    await expect(args.onSubmit).toHaveBeenCalledWith({ user_id: 'user_42', role: 'moderator' })
  },
})
