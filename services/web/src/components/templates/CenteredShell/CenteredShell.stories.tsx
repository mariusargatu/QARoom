import type { Meta, StoryObj } from '@storybook/react-vite'
import { CenteredShell } from './CenteredShell'

const meta = {
  title: 'templates/CenteredShell',
  component: CenteredShell,
  args: {
    children: <div className="rounded-lg border border-border bg-surface p-6">Login card</div>,
  },
} satisfies Meta<typeof CenteredShell>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
