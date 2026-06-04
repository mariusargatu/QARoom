import type { Meta, StoryObj } from '@storybook/react-vite'
import { DashboardTemplate } from './DashboardTemplate'

const meta = {
  title: 'templates/DashboardTemplate',
  component: DashboardTemplate,
} satisfies Meta<typeof DashboardTemplate>

export default meta
type Story = StoryObj<typeof meta>

const Box = ({ label }: { label: string }) => (
  <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">{label}</div>
)

export const Layout: Story = {
  args: {
    header: <span className="text-lg font-semibold text-text">QARoom — General</span>,
    rollout: <Box label="RolloutPanel" />,
    donation: <Box label="DonationForm" />,
    donations: <Box label="DonationList" />,
    activity: <Box label="NotificationFeed" />,
  },
}
