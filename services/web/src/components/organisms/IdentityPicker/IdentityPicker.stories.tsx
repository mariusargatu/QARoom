import { expect, fn, userEvent, within } from 'storybook/test'
import preview from '../../../../.storybook/preview'
import { IdentityPicker } from './IdentityPicker'

// CSF Factory format (ADR-0027 §4). Organism tier — first-run, remembered-identities, and error
// states plus the pick-an-identity interaction; the Avatar/Button/Card/Input atoms and FormField
// molecule inside are already proven, so these stories test only the picker's own composition.
const meta = preview.meta({
  title: 'organisms/IdentityPicker',
  component: IdentityPicker,
  // `fn()` makes the callbacks spies so a play() can assert them (Storybook resets them per story).
  args: { knownUsers: [], onSignIn: fn(), onSignUp: fn() },
})

export const FirstRun = meta.story({})
export const WithRecent = meta.story({
  args: {
    knownUsers: [
      { id: 'user_01', handle: 'ada', display_name: 'Ada Lovelace' },
      { id: 'user_02', handle: 'grace', display_name: 'Grace Hopper' },
    ],
  },
})

// Headless interaction test (Milestone 8): picking a remembered identity signs that user in.
// Clicking Grace's identity row must fire `onSignIn` with her id — not Ada's, not the handle.
export const PickingRecentIdentitySignsThatUserIn = meta.story({
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
})
export const WithError = meta.story({ args: { error: 'Community slug already taken.' } })
