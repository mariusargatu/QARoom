import preview from '../../../../.storybook/preview'
import { IconButton } from './IconButton'

// CSF Factory format (ADR-0027 §4). Atom tier — stories cover the default/disabled states this
// icon-only button ADDS; higher tiers that use it for vote/action controls don't re-test it.
const meta = preview.meta({
  title: 'atoms/IconButton',
  component: IconButton,
  args: { label: 'Upvote', children: '▲' },
})

export const Default = meta.story({})
export const Disabled = meta.story({ args: { disabled: true } })
