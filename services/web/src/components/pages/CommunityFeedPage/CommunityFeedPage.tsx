import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useFeed } from '../../../hooks/useFeed'
import { useMembers } from '../../../hooks/useMembers'
import { useVote } from '../../../hooks/useVote'
import { useSession } from '../../../session/SessionProvider'
import { Button } from '../../atoms/Button'
import { ErrorState } from '../../molecules/ErrorState'
import { SortTabs } from '../../molecules/SortTabs'
import { PostList } from '../../organisms/PostList'
import { PostRow } from '../../organisms/PostRow'
import { RightRail } from '../../organisms/RightRail'

const SORTS = [
  { value: 'new', label: 'New' },
  { value: 'top', label: 'Top' },
]

/** Page: a community feed — sortable, votable (optimistic), with a quiet "about" rail. */
export function CommunityFeedPage() {
  const { communityId = '' } = useParams()
  const { api } = useApi()
  const { currentUser, knownCommunities } = useSession()
  const feed = useFeed(api, communityId)
  const members = useMembers(api, communityId)
  const { myVotes, pendingId, error: voteError, vote } = useVote(api, currentUser?.id ?? '')
  const [sort, setSort] = useState('new')

  const community = knownCommunities.find((c) => c.id === communityId)
  const communityName = community?.name ?? communityId
  const posts = sort === 'top' ? [...feed.posts].sort((a, b) => b.score - a.score) : feed.posts

  // Optimistic: patch the voted post's score in place from the server's response — no full refetch.
  const onVote = async (postId: string, value: 1 | -1) => {
    const score = await vote(postId, value)
    if (score !== undefined) {
      feed.setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, score } : p)))
    }
  }

  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[1fr_15rem]">
      <div>
        <div className="flex items-center justify-between border-b border-border">
          <SortTabs options={SORTS} value={sort} onChange={setSort} ariaLabel="Sort posts" />
          <Link to={`/c/${communityId}/submit`}>
            <Button>New post</Button>
          </Link>
        </div>
        {voteError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {voteError}
          </p>
        ) : null}
        {feed.error ? (
          <div className="pt-6">
            <ErrorState message={feed.error} onRetry={() => void feed.refresh()} />
          </div>
        ) : (
          <PostList
            loading={feed.loading}
            isEmpty={posts.length === 0}
            emptyState={
              <div className="border-t border-border py-16 text-center">
                <p className="font-display text-xl text-text">No posts yet</p>
                <p className="mt-1 text-sm text-muted">
                  Start the conversation in {communityName}.
                </p>
                <Link
                  to={`/c/${communityId}/submit`}
                  className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                >
                  Write the first post
                </Link>
              </div>
            }
          >
            {posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                to={`/c/${communityId}/p/${post.id}`}
                voteValue={myVotes[post.id] ?? 0}
                votePending={pendingId === post.id}
                onVote={(value) => void onVote(post.id, value)}
              />
            ))}
          </PostList>
        )}
      </div>
      <aside className="hidden lg:block">
        <RightRail
          name={communityName}
          slug={community?.slug ?? communityId}
          memberCount={members.loading ? undefined : members.members.length}
        />
      </aside>
    </div>
  )
}
