import preview from '../../../../.storybook/preview'
import { EmptyState } from '../../molecules/EmptyState'
import { PostList } from './PostList'

// CSF Factory format (ADR-0027 §4). Organism tier — the loading and empty states of the feed
// container; the Skeleton atom and the injected EmptyState molecule are already proven, so these
// stories test only the list's own composition (the loading/empty switch around its children).
const meta = preview.meta({
  title: 'organisms/PostList',
  component: PostList,
})

export const Loading = meta.story({ args: { loading: true } })
export const Empty = meta.story({
  args: { isEmpty: true, emptyState: <EmptyState title="No posts yet" icon="📝" /> },
})
