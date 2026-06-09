import type { Meta, StoryObj } from '@storybook/react-vite'
import { Card } from './Card'

const meta = {
  title: 'atoms/Card',
  component: Card,
  args: { className: 'p-4 max-w-sm', children: 'A surface container.' },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Interactive: Story = { args: { interactive: true } }
