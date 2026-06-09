import { Link, useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { usePost } from '../../../hooks/usePost'
import { useVote } from '../../../hooks/useVote'
import { formatDate, shortId } from '../../../lib/format'
import { useSession } from '../../../session/SessionProvider'
import { Avatar } from '../../atoms/Avatar'
import { Card } from '../../atoms/Card'
import { Skeleton } from '../../atoms/Skeleton'
import { ErrorState } from '../../molecules/ErrorState'
import { VoteControl } from '../../molecules/VoteControl'

/** Page: a single post with its vote control and full body. */
export function PostDetailPage() {
  const { communityId = '', postId = '' } = useParams()
  const { api } = useApi()
  const { currentUser } = useSession()
  const { post, loading, error, setPost, refresh } = usePost(api, postId)
  const { myVotes, pendingId, error: voteError, vote } = useVote(api, currentUser?.id ?? '')

  const onVote = async (value: 1 | -1) => {
    if (!post) return
    const score = await vote(post.id, value)
    if (score !== undefined) setPost({ ...post, score })
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Link to={`/c/${communityId}`} className="text-sm text-muted hover:text-text">
        ← Back to feed
      </Link>
      {voteError ? (
        <p role="alert" className="text-sm text-danger">
          {voteError}
        </p>
      ) : null}
      {loading ? (
        <Card className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : error || !post ? (
        <ErrorState message={error ?? 'Post not found.'} onRetry={() => void refresh()} />
      ) : (
        <Card className="flex gap-4 p-5">
          <VoteControl
            score={post.score}
            value={myVotes[post.id] ?? 0}
            pending={pendingId === post.id}
            onVote={(value) => void onVote(value)}
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-medium leading-tight text-text">
              {post.title}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted">
              <Avatar name={post.author_id} size="sm" />
              <span className="truncate">{shortId(post.author_id)}</span>
              <span aria-hidden="true">·</span>
              <span>{formatDate(post.created_at)}</span>
            </div>
            {post.body ? (
              <p className="mt-4 whitespace-pre-wrap text-sm text-text">{post.body}</p>
            ) : (
              <p className="mt-4 text-sm text-muted">No body.</p>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
