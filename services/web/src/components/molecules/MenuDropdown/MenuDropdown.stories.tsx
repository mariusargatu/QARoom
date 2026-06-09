import type { Meta, StoryObj } from '@storybook/react-vite'
import { MenuDropdown } from './MenuDropdown'

const meta = {
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
} satisfies Meta<typeof MenuDropdown>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
