import preview from '../../../../.storybook/preview'
import { RightRail } from './RightRail'

// CSF Factory format (ADR-0027 §4). Organism tier — the donations-on vs donations-off community
// sidebar; the Badge atom inside is already proven, so these stories test only the rail's own
// composition (community stats + the conditional donations total).
const meta = preview.meta({
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
})

export const Default = meta.story({})
export const DonationsOff = meta.story({
  args: { donationsEnabled: false, totalDonationsCents: 0 },
})
