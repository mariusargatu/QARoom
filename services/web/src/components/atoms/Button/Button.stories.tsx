import preview from '../../../../.storybook/preview'
import { Button } from './Button'

// CSF Factory format (ADR-0027 §4): `preview.meta()` → `meta.story()`, type-inferred from props, no
// default export. Atom tier — stories cover the variants this atom ADDS; higher tiers don't re-test it.
const meta = preview.meta({
  title: 'atoms/Button',
  component: Button,
  args: { children: 'Advance rollout' },
})

export const Primary = meta.story({ args: { variant: 'primary' } })
export const Ghost = meta.story({ args: { variant: 'ghost' } })
export const Danger = meta.story({ args: { variant: 'danger', children: 'Disable' } })
export const Disabled = meta.story({ args: { disabled: true } })
