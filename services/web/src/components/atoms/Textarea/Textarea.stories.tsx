import type { Meta, StoryObj } from '@storybook/react-vite'
import { Textarea } from './Textarea'

const meta = {
  title: 'atoms/Textarea',
  component: Textarea,
  args: { placeholder: 'Write your post…', 'aria-label': 'Post body' },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Filled: Story = { args: { defaultValue: 'A short note on deterministic clocks.' } }
export const Invalid: Story = { args: { invalid: true } }
