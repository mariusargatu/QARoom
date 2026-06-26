import { EXAMPLE_AS_OF, EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import preview from '../../../../.storybook/preview'
import { FlagList } from './FlagList'

const flag = (flag_key: string, state: 'Off' | 'Enabled' | 'Canary') => ({
  community_id: EXAMPLE_COMMUNITY_ID,
  flag_key,
  state,
  enabled: state === 'Enabled',
  as_of: EXAMPLE_AS_OF,
})

// CSF Factory format (ADR-0027 §4). Organism tier — the populated/loading/empty states of the flag
// roster; the RolloutStepper molecule and Skeleton atom inside are already proven, so these stories
// test only the list's own composition (one rollout row per flag).
const meta = preview.meta({
  title: 'organisms/FlagList',
  component: FlagList,
  args: { flags: [flag('donations', 'Enabled'), flag('dark-mode', 'Off')], onAdvance: () => {} },
})

export const Default = meta.story({})
export const Loading = meta.story({ args: { loading: true, flags: [] } })
export const Empty = meta.story({ args: { flags: [] } })
