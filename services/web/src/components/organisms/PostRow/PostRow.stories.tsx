import { EXAMPLE_POST } from '@qaroom/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { PostRow } from './PostRow'

const meta = {
  title: 'organisms/PostRow',
  component: PostRow,
  args: { post: EXAMPLE_POST, to: '#', authorName: 'Ada Lovelace', onVote: () => {} },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="max-w-2xl px-4">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof PostRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Upvoted: Story = { args: { voteValue: 1, post: { ...EXAMPLE_POST, score: 143 } } }
