import preview from '../../../../.storybook/preview'
import { Input } from '../../atoms/Input'
import { FormField } from './FormField'

// CSF Factory format (ADR-0027 §4). Molecule tier — the labelled control wrapper around the Input atom
// (already proven); these stories cover only what it adds (label + required marker + hint/error text).
const meta = preview.meta({
  title: 'molecules/FormField',
  component: FormField,
  args: { label: 'Handle', children: <Input placeholder="ada" /> },
})

export const Default = meta.story({})
export const Required = meta.story({ args: { required: true, hint: 'lowercase, 2–40 chars' } })
export const WithError = meta.story({
  args: { error: 'must be lowercase alphanumeric + underscore' },
})
