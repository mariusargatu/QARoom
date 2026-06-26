import preview from '../../../../.storybook/preview'
import { Avatar } from './Avatar'

// CSF Factory format (ADR-0027 §4). Atom tier — stories cover the size/initials/colour variants this
// atom ADDS (including branded-id initials); higher tiers compose it and don't re-test those.
const meta = preview.meta({
  title: 'atoms/Avatar',
  component: Avatar,
  args: { name: 'Ada Lovelace' },
})

export const Medium = meta.story({})
export const Small = meta.story({ args: { size: 'sm' } })
export const Large = meta.story({ args: { size: 'lg', name: 'Grace Hopper' } })
export const SingleWord = meta.story({ args: { name: 'ada' } })
export const BrandedId = meta.story({ args: { name: 'user_01KTKPMB7QF8Z3J267EZN' } })
