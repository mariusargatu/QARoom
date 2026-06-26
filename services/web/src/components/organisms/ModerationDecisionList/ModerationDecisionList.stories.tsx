import { EXAMPLE_MODERATION_DECISION, ModerationDecision } from '@qaroom/contracts'
import preview from '../../../../.storybook/preview'
import { ModerationDecisionList } from './ModerationDecisionList'

// CSF Factory format (ADR-0027 §4). Organism tier — the populated/loading/empty states of the
// decision log; the DecisionCard organism it wraps and the Skeleton atom are already proven, so
// these stories test only the list's own composition (stacking cards + loading/empty fallbacks).
const meta = preview.meta({
  title: 'organisms/ModerationDecisionList',
  component: ModerationDecisionList,
  args: { decisions: [ModerationDecision.parse(EXAMPLE_MODERATION_DECISION)] },
})

export const WithDecisions = meta.story({})
export const Loading = meta.story({ args: { loading: true, decisions: [] } })
export const Empty = meta.story({ args: { decisions: [] } })
