import { EXAMPLE_MODERATION_DECISION, ModerationDecision } from '@qaroom/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ModerationDecisionList } from './ModerationDecisionList'

const meta = {
  title: 'organisms/ModerationDecisionList',
  component: ModerationDecisionList,
  args: { decisions: [ModerationDecision.parse(EXAMPLE_MODERATION_DECISION)] },
} satisfies Meta<typeof ModerationDecisionList>

export default meta
type Story = StoryObj<typeof meta>

export const WithDecisions: Story = {}
export const Loading: Story = { args: { loading: true, decisions: [] } }
export const Empty: Story = { args: { decisions: [] } }
