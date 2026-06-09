import type { Meta, StoryObj } from '@storybook/react-vite'
import { ErrorState } from './ErrorState'

const meta = {
  title: 'molecules/ErrorState',
  component: ErrorState,
  args: { message: 'flags-service is unreachable or timed out.', onRetry: () => {} },
} satisfies Meta<typeof ErrorState>

export default meta
type Story = StoryObj<typeof meta>

export const Retryable: Story = {}
export const NotRetryable: Story = {
  args: { title: 'Not found', message: 'No post with that id exists.', retryable: false },
}
