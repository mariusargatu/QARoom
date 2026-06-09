import type { Meta, StoryObj } from '@storybook/react-vite'
import { AppShell } from './AppShell'

const meta = {
  title: 'templates/AppShell',
  component: AppShell,
  args: {
    masthead: (
      <div className="border-b border-border bg-bg px-4 py-4 font-display text-xl">QARoom</div>
    ),
    children: <div className="text-sm">Routed content</div>,
  },
} satisfies Meta<typeof AppShell>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
