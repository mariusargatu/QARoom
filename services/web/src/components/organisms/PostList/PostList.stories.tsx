import type { Meta, StoryObj } from '@storybook/react-vite'
import { EmptyState } from '../../molecules/EmptyState'
import { PostList } from './PostList'

const meta = {
  title: 'organisms/PostList',
  component: PostList,
} satisfies Meta<typeof PostList>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = { args: { loading: true } }
export const Empty: Story = {
  args: { isEmpty: true, emptyState: <EmptyState title="No posts yet" icon="📝" /> },
}
