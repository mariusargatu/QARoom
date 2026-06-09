import type { Meta, StoryObj } from '@storybook/react-vite'
import { SortTabs } from './SortTabs'

const meta = {
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
} satisfies Meta<typeof SortTabs>

export default meta
type Story = StoryObj<typeof meta>

export const New: Story = {}
export const Top: Story = { args: { value: 'top' } }
