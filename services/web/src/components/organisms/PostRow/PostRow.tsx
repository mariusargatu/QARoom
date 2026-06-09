import type { Post } from '@qaroom/contracts'
import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, shortId } from '../../../lib/format'
import { VoteControl, type VoteValue } from '../../molecules/VoteControl'

export interface PostRowProps {
  post: Post
  /** Router path to the post detail. */
  to: string
  /** Resolved author display name; falls back to the author id. */
  authorName?: string
  voteValue?: VoteValue
  votePending?: boolean
  onVote: (value: 1 | -1) => void
}

/**
 * Organism: a feed row (DESIGN.md signature component). No card — a vote cluster, a Fraunces title
 * link, a spare meta line, and a two-line excerpt, separated from siblings by a hairline (the list
 * owns the rule). This is the editorial replacement for the old PostCard.
 */
export const PostRow = forwardRef<HTMLElement, PostRowProps>(function PostRow(
  { post, to, authorName, voteValue = 0, votePending = false, onVote },
  ref,
) {
  const author = authorName ?? shortId(post.author_id)
  return (
    <article ref={ref} className="flex gap-4 py-5">
      <VoteControl score={post.score} value={voteValue} pending={votePending} onVote={onVote} />
      <div className="min-w-0 flex-1">
        <Link
          to={to}
          className="font-display text-xl font-medium leading-snug text-text transition-colors hover:text-primary motion-reduce:transition-none"
        >
          {post.title}
        </Link>
        <p className="mt-1 text-xs text-muted">
          by {author} <span aria-hidden="true">·</span> {formatDate(post.created_at)}
        </p>
        {post.body ? (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{post.body}</p>
        ) : null}
      </div>
    </article>
  )
})
PostRow.displayName = 'PostRow'
