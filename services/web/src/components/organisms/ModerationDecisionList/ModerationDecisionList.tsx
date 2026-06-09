import type { ModerationDecision } from '@qaroom/contracts'
import { forwardRef } from 'react'
import { Skeleton } from '../../atoms/Skeleton'
import { DecisionCard } from '../DecisionCard'

export interface ModerationDecisionListProps {
  decisions: ModerationDecision[]
  loading?: boolean
}

/**
 * Organism: the moderation decision ledger. Rows are separated by hairlines, no cards (DESIGN.md).
 * Loading → skeleton rows; empty → an editorial empty state, not an icon-in-box.
 */
export const ModerationDecisionList = forwardRef<HTMLDivElement, ModerationDecisionListProps>(
  function ModerationDecisionList({ decisions, loading = false }, ref) {
    if (loading) {
      return (
        <div ref={ref} className="divide-y divide-border border-t border-border" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2 py-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      )
    }
    if (decisions.length === 0) {
      return (
        <div ref={ref} className="border-t border-border py-16 text-center">
          <p className="font-display text-xl text-text">No moderation decisions yet</p>
          <p className="mt-1 text-sm text-muted">
            The agent records a decision when a post is created.
          </p>
        </div>
      )
    }
    return (
      <div ref={ref} className="divide-y divide-border border-t border-border">
        {decisions.map((decision) => (
          <DecisionCard key={decision.decision_id} decision={decision} />
        ))}
      </div>
    )
  },
)
ModerationDecisionList.displayName = 'ModerationDecisionList'
