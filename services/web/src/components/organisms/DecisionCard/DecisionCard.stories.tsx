import { EXAMPLE_MODERATION_DECISION, ModerationDecision } from '@qaroom/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { DecisionCard } from './DecisionCard'

const approve = ModerationDecision.parse(EXAMPLE_MODERATION_DECISION)

const meta = {
  title: 'organisms/DecisionCard',
  component: DecisionCard,
  args: { decision: approve },
} satisfies Meta<typeof DecisionCard>

export default meta
type Story = StoryObj<typeof meta>

export const Approve: Story = {}
export const Remove: Story = {
  args: {
    decision: ModerationDecision.parse({
      ...EXAMPLE_MODERATION_DECISION,
      disposition: 'remove',
      confidence: 0.91,
      cited_rules: ['no-harassment'],
      precedents: ['remove (no-harassment): a prior slur removal'],
      rationale: 'Targets an individual with a slur, matching the cited no-harassment rule.',
    }),
  },
}
export const Escalate: Story = {
  args: {
    decision: ModerationDecision.parse({
      ...EXAMPLE_MODERATION_DECISION,
      disposition: 'escalate_to_human',
      confidence: 0.4,
      departs_from_precedent: true,
      rationale: 'Ambiguous — retrieval confidence low; escalated to a human moderator.',
    }),
  },
}
