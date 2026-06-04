import { EXAMPLE_DONATION } from '@qaroom/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { DonationList } from './DonationList'

const meta = {
  title: 'organisms/DonationList',
  component: DonationList,
} satisfies Meta<typeof DonationList>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { args: { donations: [] } }
export const WithDonations: Story = {
  args: {
    donations: [
      { ...EXAMPLE_DONATION, status: 'Captured' },
      { ...EXAMPLE_DONATION, id: 'dntn_01HZY0K7M3QF8VN2J5RX9TB4CN', status: 'Failed' },
    ],
  },
}
