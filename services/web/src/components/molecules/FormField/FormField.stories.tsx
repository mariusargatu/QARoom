import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from '../../atoms/Input'
import { FormField } from './FormField'

const meta = {
  title: 'molecules/FormField',
  component: FormField,
  args: { label: 'Handle', children: <Input placeholder="ada" /> },
} satisfies Meta<typeof FormField>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Required: Story = { args: { required: true, hint: 'lowercase, 2–40 chars' } }
export const WithError: Story = { args: { error: 'must be lowercase alphanumeric + underscore' } }
