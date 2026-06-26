import preview from '../../../../.storybook/preview'
import { Textarea } from './Textarea'

// CSF Factory format (ADR-0027 §4). Atom tier — stories cover the default/filled/invalid states this
// multi-line input ADDS; higher tiers that compose it into forms don't re-test the field states.
const meta = preview.meta({
  title: 'atoms/Textarea',
  component: Textarea,
  args: { placeholder: 'Write your post…', 'aria-label': 'Post body' },
})

export const Default = meta.story({})
export const Filled = meta.story({
  args: { defaultValue: 'A short note on deterministic clocks.' },
})
export const Invalid = meta.story({ args: { invalid: true } })
