import preview from '../../../../.storybook/preview'
import { DashboardTemplate } from './DashboardTemplate'

// CSF Factory format (ADR-0027 §4). Template tier — pure two-column dashboard layout. The organisms
// that fill its slots (RolloutPanel, DonationForm, DonationList, NotificationFeed) are already proven
// at the organism tier, so this story tests only the slot arrangement the template ADDS — placeholder
// boxes stand in for the real organisms.
const meta = preview.meta({
  title: 'templates/DashboardTemplate',
  component: DashboardTemplate,
})

const Box = ({ label }: { label: string }) => (
  <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">{label}</div>
)

export const Layout = meta.story({
  args: {
    header: <span className="text-lg font-semibold text-text">QARoom — General</span>,
    rollout: <Box label="RolloutPanel" />,
    donation: <Box label="DonationForm" />,
    donations: <Box label="DonationList" />,
    activity: <Box label="NotificationFeed" />,
  },
})
