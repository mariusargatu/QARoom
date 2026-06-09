import type { Meta, StoryObj } from '@storybook/react-vite'
import { RightRail } from './RightRail'

const meta = {
  title: 'organisms/RightRail',
  component: RightRail,
  args: {
    name: 'General',
    slug: 'general',
    memberCount: 42,
    createdAt: '2026-05-28T12:00:00.000Z',
    donationsEnabled: true,
    totalDonationsCents: 125000,
  },
} satisfies Meta<typeof RightRail>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const DonationsOff: Story = { args: { donationsEnabled: false, totalDonationsCents: 0 } }
