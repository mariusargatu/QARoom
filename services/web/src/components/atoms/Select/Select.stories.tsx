import type { Meta, StoryObj } from '@storybook/react-vite'
import { Select } from './Select'

const meta = {
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
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Disabled: Story = { args: { disabled: true } }
