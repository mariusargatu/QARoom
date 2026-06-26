import preview from '../../../../.storybook/preview'
import { Badge } from './Badge'

// CSF Factory format (ADR-0027 §4). Atom tier — stories cover the tone variants this status pill ADDS;
// higher tiers that render rollout/donation status with it don't re-test the tones.
const meta = preview.meta({
  title: 'atoms/Badge',
  component: Badge,
  args: { children: 'Enabled' },
})

export const Neutral = meta.story({ args: { tone: 'neutral', children: 'Off' } })
export const Primary = meta.story({ args: { tone: 'primary', children: 'Enabling' } })
export const Success = meta.story({ args: { tone: 'success', children: 'Enabled' } })
export const Danger = meta.story({ args: { tone: 'danger', children: 'Failed' } })
