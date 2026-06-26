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
