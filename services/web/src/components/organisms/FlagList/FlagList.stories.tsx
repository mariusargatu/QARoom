import { EXAMPLE_AS_OF, EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { FlagList } from './FlagList'

const flag = (flag_key: string, state: 'Off' | 'Enabled' | 'Canary') => ({
  community_id: EXAMPLE_COMMUNITY_ID,
  flag_key,
  state,
  enabled: state === 'Enabled',
  as_of: EXAMPLE_AS_OF,
})

const meta = {
  title: 'organisms/FlagList',
  component: FlagList,
  args: { flags: [flag('donations', 'Enabled'), flag('dark-mode', 'Off')], onAdvance: () => {} },
} satisfies Meta<typeof FlagList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Loading: Story = { args: { loading: true, flags: [] } }
export const Empty: Story = { args: { flags: [] } }
