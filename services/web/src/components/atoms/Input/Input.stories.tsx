import preview from '../../../../.storybook/preview'
import { Input } from './Input'

// CSF Factory format (ADR-0027 §4). Atom tier — stories cover the default/filled/invalid/disabled
// states this input ADDS; higher tiers that compose it into forms don't re-test the field states.
const meta = preview.meta({
  title: 'atoms/Input',
  component: Input,
  args: { placeholder: 'community slug', 'aria-label': 'Community slug' },
})

export const Default = meta.story({})
export const Filled = meta.story({ args: { defaultValue: 'general' } })
export const Invalid = meta.story({ args: { invalid: true, defaultValue: 'Bad Slug!' } })
export const Disabled = meta.story({ args: { disabled: true, defaultValue: 'general' } })
