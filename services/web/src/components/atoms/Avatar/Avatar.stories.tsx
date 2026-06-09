import type { Meta, StoryObj } from '@storybook/react-vite'
import { Avatar } from './Avatar'

const meta = {
  title: 'atoms/Avatar',
  component: Avatar,
  args: { name: 'Ada Lovelace' },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const Medium: Story = {}
export const Small: Story = { args: { size: 'sm' } }
export const Large: Story = { args: { size: 'lg', name: 'Grace Hopper' } }
export const SingleWord: Story = { args: { name: 'ada' } }
export const BrandedId: Story = { args: { name: 'user_01KTKPMB7QF8Z3J267EZN' } }
