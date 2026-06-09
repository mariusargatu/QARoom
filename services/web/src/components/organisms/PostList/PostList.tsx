import { forwardRef, type ReactNode } from 'react'
import { Skeleton } from '../../atoms/Skeleton'

export interface PostListProps {
  loading?: boolean
  isEmpty?: boolean
  emptyState?: ReactNode
  children?: ReactNode
}

/**
 * Organism: the feed column. Rows are separated by hairlines, no cards (DESIGN.md). Owns the
 * loading/empty presentation; the page supplies the PostRows.
 */
export const PostList = forwardRef<HTMLDivElement, PostListProps>(function PostList(
  { loading = false, isEmpty = false, emptyState, children },
  ref,
) {
  if (loading) {
    return (
      <div ref={ref} className="divide-y divide-border border-t border-border" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 py-5">
            <Skeleton className="h-16 w-11" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (isEmpty) return <div ref={ref}>{emptyState}</div>
  return (
    <div ref={ref} className="divide-y divide-border border-t border-border">
      {children}
    </div>
  )
})
PostList.displayName = 'PostList'
