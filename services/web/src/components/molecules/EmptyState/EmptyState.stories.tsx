import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../../atoms/Button'
import { EmptyState } from './EmptyState'

const meta = {
  title: 'molecules/EmptyState',
  component: EmptyState,
  args: {
    title: 'No posts yet',
    description: 'Be the first to post in this community.',
    icon: '📝',
  },
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithAction: Story = { args: { action: <Button>Create a post</Button> } }
