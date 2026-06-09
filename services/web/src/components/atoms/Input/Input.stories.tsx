import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from './Input'

const meta = {
  title: 'atoms/Input',
  component: Input,
  args: { placeholder: 'community slug', 'aria-label': 'Community slug' },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Filled: Story = { args: { defaultValue: 'general' } }
export const Invalid: Story = { args: { invalid: true, defaultValue: 'Bad Slug!' } }
export const Disabled: Story = { args: { disabled: true, defaultValue: 'general' } }
