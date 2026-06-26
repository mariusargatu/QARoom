import preview from '../../../../.storybook/preview'
import { SortTabs } from './SortTabs'

// CSF Factory format (ADR-0027 §4). Molecule tier — the segmented sort control; these stories cover
// only its own composition (the active option's `aria-pressed` + the group's accessible name).
const meta = preview.meta({
  title: 'molecules/SortTabs',
  component: SortTabs,
  args: {
    options: [
      { value: 'new', label: 'New' },
      { value: 'top', label: 'Top' },
    ],
    value: 'new',
    onChange: () => {},
  },
})

export const New = meta.story({})
export const Top = meta.story({ args: { value: 'top' } })
