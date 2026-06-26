import preview from '../../../../.storybook/preview'
import { Skeleton } from './Skeleton'

// CSF Factory format (ADR-0027 §4). Atom tier — stories cover the line/block sizings this placeholder
// ADDS; higher tiers that show loading states with it don't re-test the placeholder.
const meta = preview.meta({
  title: 'atoms/Skeleton',
  component: Skeleton,
  args: { className: 'h-4 w-48' },
})

export const Line = meta.story({})
export const Block = meta.story({ args: { className: 'h-24 w-64' } })
