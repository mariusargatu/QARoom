import type { Membership, Role } from '@qaroom/contracts'
import { forwardRef } from 'react'
import { formatDate, shortId } from '../../../lib/format'
import { Avatar } from '../../atoms/Avatar'
import { Badge, type BadgeTone } from '../../atoms/Badge'
import { Skeleton } from '../../atoms/Skeleton'

export interface MemberListProps {
  members: Membership[]
  loading?: boolean
}

const ROLE_TONE: Record<Role, BadgeTone> = {
  owner: 'primary',
  moderator: 'warning',
  member: 'neutral',
}

/**
 * Organism: a community's roster — avatar, user, role, join date. Hairline-separated rows, no cards
 * (DESIGN.md), mirroring the feed.
 */
export const MemberList = forwardRef<HTMLDivElement, MemberListProps>(function MemberList(
  { members, loading = false },
  ref,
) {
  if (loading) {
    return (
      <div ref={ref} className="divide-y divide-border border-t border-border" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 py-4">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    )
  }
  if (members.length === 0) {
    return (
      <div ref={ref} className="border-t border-border py-16 text-center">
        <p className="font-display text-xl text-text">No members yet</p>
        <p className="mt-1 text-sm text-muted">Add the first member below.</p>
      </div>
    )
  }
  return (
    <div ref={ref} className="divide-y divide-border border-t border-border">
      {members.map((member) => (
        <div key={member.user_id} className="flex items-center gap-3 py-4">
          <Avatar name={member.user_id} size="sm" />
          <span
            className="min-w-0 flex-1 truncate font-mono text-sm text-text"
            title={member.user_id}
          >
            {shortId(member.user_id)}
          </span>
          <Badge tone={ROLE_TONE[member.role]}>{member.role}</Badge>
          <span className="text-xs text-muted">{formatDate(member.joined_at)}</span>
        </div>
      ))}
    </div>
  )
})
MemberList.displayName = 'MemberList'
