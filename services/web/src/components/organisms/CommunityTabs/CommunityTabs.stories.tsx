import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { CommunityTabs } from './CommunityTabs'

const meta = {
  title: 'organisms/CommunityTabs',
  component: CommunityTabs,
  args: { communityId: 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof CommunityTabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
