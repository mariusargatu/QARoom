import type { User } from '@qaroom/contracts'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useResource } from '../../../hooks/useResource'
import { formatDate } from '../../../lib/format'
import { useSession } from '../../../session/SessionProvider'
import { Avatar } from '../../atoms/Avatar'
import { Badge } from '../../atoms/Badge'
import { Skeleton } from '../../atoms/Skeleton'
import { ErrorState } from '../../molecules/ErrorState'

/** Page: a user profile by id; for your own profile it also lists your memberships. */
export function ProfilePage() {
  const { userId = '' } = useParams()
  const { api } = useApi()
  const { currentUser, memberships, knownCommunities } = useSession()
  const {
    data: user,
    loading,
    error,
  } = useResource<User | null>(() => api.getUser(userId), [api, userId], null)

  const isMe = currentUser?.id === userId
  const nameFor = (id: string) => knownCommunities.find((c) => c.id === id)?.name ?? id

  if (loading) {
    return (
      <div className="mx-auto flex max-w-xl items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    )
  }
  if (error || !user) {
    return <ErrorState message={error ?? 'User not found.'} retryable={false} />
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8">
      <header className="flex items-center gap-4">
        <Avatar name={user.display_name} size="lg" />
        <div>
          <h1 className="font-display text-2xl font-medium text-text">{user.display_name}</h1>
          <p className="text-sm text-muted">@{user.handle}</p>
          <p className="text-xs text-muted">Joined {formatDate(user.created_at)}</p>
        </div>
      </header>
      {isMe ? (
        <section>
          <h2 className="font-display text-lg font-medium text-text">Your memberships</h2>
          {memberships.length === 0 ? (
            <p className="py-6 text-sm text-muted">No memberships yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border border-t border-border">
              {memberships.map((membership) => (
                <li
                  key={membership.community_id}
                  className="flex items-center justify-between py-4"
                >
                  <Link
                    to={`/c/${membership.community_id}`}
                    className="truncate text-sm text-text transition-colors hover:text-primary motion-reduce:transition-none"
                  >
                    {nameFor(membership.community_id)}
                  </Link>
                  <Badge tone="neutral">{membership.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  )
}
