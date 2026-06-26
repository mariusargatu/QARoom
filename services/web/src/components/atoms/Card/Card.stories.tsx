import preview from '../../../../.storybook/preview'
import { Card } from './Card'

// CSF Factory format (ADR-0027 §4). Atom tier — stories cover the surface/interactive variants this
// container ADDS; higher tiers that wrap content in it don't re-test the surface look.
const meta = preview.meta({
  title: 'atoms/Card',
  component: Card,
  args: { className: 'p-4 max-w-sm', children: 'A surface container.' },
})

export const Default = meta.story({})
export const Interactive = meta.story({ args: { interactive: true } })
