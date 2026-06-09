import { EXAMPLE_MEMBERSHIP, Membership } from '@qaroom/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemberList } from './MemberList'

const meta = {
  title: 'organisms/MemberList',
  component: MemberList,
  args: {
    members: [
      Membership.parse({ ...EXAMPLE_MEMBERSHIP, role: 'owner' }),
      Membership.parse(EXAMPLE_MEMBERSHIP),
    ],
  },
} satisfies Meta<typeof MemberList>

export default meta
type Story = StoryObj<typeof meta>

export const WithMembers: Story = {}
export const Loading: Story = { args: { loading: true, members: [] } }
export const Empty: Story = { args: { members: [] } }
