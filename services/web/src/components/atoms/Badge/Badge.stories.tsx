import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'

const meta = {
  title: 'atoms/Badge',
  component: Badge,
  args: { children: 'Enabled' },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Neutral: Story = { args: { tone: 'neutral', children: 'Off' } }
export const Primary: Story = { args: { tone: 'primary', children: 'Enabling' } }
export const Success: Story = { args: { tone: 'success', children: 'Enabled' } }
export const Danger: Story = { args: { tone: 'danger', children: 'Failed' } }
