import { EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { NotificationFeed } from './NotificationFeed'

const meta = {
  title: 'organisms/NotificationFeed',
  component: NotificationFeed,
} satisfies Meta<typeof NotificationFeed>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { args: { events: [] } }
export const Live: Story = {
  args: {
    live: true,
    events: [
      {
        type: 'flag.state.changed',
        seq: 1,
        community_id: EXAMPLE_COMMUNITY_ID,
        occurred_at: '2026-06-04T00:00:00.000Z',
        flag_key: 'donations',
        state: 'Enabled',
        enabled: true,
      },
    ],
  },
}
export const Polling: Story = { args: { ...Live.args, live: false } }
