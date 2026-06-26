import preview from '../../../../.storybook/preview'
import { Select } from './Select'

// CSF Factory format (ADR-0027 §4). Atom tier — stories cover the default/disabled states this native
// select ADDS; higher tiers that compose it into forms don't re-test it.
const meta = preview.meta({
  title: 'atoms/Select',
  component: Select,
  args: { 'aria-label': 'Role' },
  render: (args) => (
    <Select {...args}>
      <option value="member">member</option>
      <option value="moderator">moderator</option>
      <option value="owner">owner</option>
    </Select>
  ),
})

export const Default = meta.story({})
export const Disabled = meta.story({ args: { disabled: true } })
