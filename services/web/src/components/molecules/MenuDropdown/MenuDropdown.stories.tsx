import { expect } from 'storybook/test'
import preview from '../../../../.storybook/preview'
import { MenuDropdown } from './MenuDropdown'

// CSF Factory format (ADR-0027 §4). Molecule tier — the click-to-open popover menu; the trigger and
// menu content are passed in, so this story covers only the open/close shell the molecule itself adds.
const meta = preview.meta({
  title: 'molecules/MenuDropdown',
  component: MenuDropdown,
  args: {
    label: 'Account menu',
    trigger: 'ada ▾',
    children: (
      <button
        type="button"
        className="block w-full rounded px-3 py-1.5 text-left text-sm text-text"
      >
        Sign out
      </button>
    ),
  },
})

export const Default = meta.story({})

// The OPEN state, and it has to be a story rather than only a component test: axe runs per story, so
// a popover with no open-state story is a region the a11y gate structurally cannot reach. That gap
// hid a critical `aria-required-children` violation (the panel claimed `role="menu"` over plain
// links) through every green run — the gate was wired correctly and simply never saw the markup.
// Any popover added later needs an equivalent story for the same reason.
export const Open = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Account menu' }))
    await expect(canvas.getByRole('button', { name: 'Sign out' })).toBeVisible()
  },
})
