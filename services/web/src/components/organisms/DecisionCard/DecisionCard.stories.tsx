import { EXAMPLE_MODERATION_DECISION, ModerationDecision } from '@qaroom/contracts'
import preview from '../../../../.storybook/preview'
import { DecisionCard } from './DecisionCard'

const approve = ModerationDecision.parse(EXAMPLE_MODERATION_DECISION)

// CSF Factory format (ADR-0027 §4). Organism tier — the three disposition renderings of a single
// moderation decision; the Badge atom inside is already proven, so these stories test only the
// card's own composition (disposition tone, cited rules/precedents, rationale).
const meta = preview.meta({
  title: 'organisms/DecisionCard',
  component: DecisionCard,
  args: { decision: approve },
})

export const Approve = meta.story({})
export const Remove = meta.story({
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
})
export const Escalate = meta.story({
  args: {
    decision: ModerationDecision.parse({
      ...EXAMPLE_MODERATION_DECISION,
      disposition: 'escalate_to_human',
      confidence: 0.4,
      departs_from_precedent: true,
      rationale: 'Ambiguous — retrieval confidence low; escalated to a human moderator.',
    }),
  },
})
