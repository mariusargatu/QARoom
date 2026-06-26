import preview from '../../../../.storybook/preview'
import { Button } from '../../atoms/Button'
import { EmptyState } from './EmptyState'

// CSF Factory format (ADR-0027 §4). Molecule tier — the "nothing here yet" panel over the Card atom
// (already proven); these stories cover only its own composition (title/description/icon + optional action).
const meta = preview.meta({
  title: 'molecules/EmptyState',
  component: EmptyState,
  args: {
    title: 'No posts yet',
    description: 'Be the first to post in this community.',
    icon: '📝',
  },
})

export const Default = meta.story({})
export const WithAction = meta.story({ args: { action: <Button>Create a post</Button> } })
