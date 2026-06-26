import { EXAMPLE_POST } from '@qaroom/contracts'
import { MemoryRouter } from 'react-router-dom'
import preview from '../../../../.storybook/preview'
import { PostRow } from './PostRow'

// CSF Factory format (ADR-0027 §4). Organism tier — the default vs upvoted rendering of a feed row;
// the VoteControl molecule inside is already proven, so these stories test only the row's own
// composition (title link + score + author). MemoryRouter supplies routing for its post link.
const meta = preview.meta({
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
})

export const Default = meta.story({})
export const Upvoted = meta.story({ args: { voteValue: 1, post: { ...EXAMPLE_POST, score: 143 } } })
