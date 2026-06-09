import type { ModerationDecision, ModerationDisposition } from '@qaroom/contracts'
import { forwardRef } from 'react'
import { formatDateTime } from '../../../lib/format'
import { Badge, type BadgeTone } from '../../atoms/Badge'

export interface DecisionCardProps {
  decision: ModerationDecision
}

const DISPOSITION_TONE: Record<ModerationDisposition, BadgeTone> = {
  approve: 'success',
  remove: 'danger',
  escalate_to_human: 'warning',
}

const DISPOSITION_LABEL: Record<ModerationDisposition, string> = {
  approve: 'Approve',
  remove: 'Remove',
  escalate_to_human: 'Escalate',
}

/**
 * Organism: one grounded moderation decision — disposition, confidence, rationale, citations.
 * A hairline editorial block (no card); the list separates siblings with a rule (DESIGN.md).
 */
export const DecisionCard = forwardRef<HTMLDivElement, DecisionCardProps>(function DecisionCard(
  { decision },
  ref,
) {
  return (
    <div ref={ref} className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={DISPOSITION_TONE[decision.disposition]}>
          {DISPOSITION_LABEL[decision.disposition]}
        </Badge>
        <span className="text-xs text-muted">
          {Math.round(decision.confidence * 100)}% confidence
        </span>
        {decision.departs_from_precedent ? (
          <Badge tone="warning">Departs from precedent</Badge>
        ) : null}
        <span className="ml-auto text-xs text-muted">{formatDateTime(decision.created_at)}</span>
      </div>
      <p className="text-sm text-text">{decision.rationale}</p>
      {decision.cited_rules.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {decision.cited_rules.map((rule) => (
            <Badge key={rule} tone="neutral">
              {rule}
            </Badge>
          ))}
        </div>
      ) : null}
      {decision.precedents.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          {decision.precedents.map((precedent) => (
            <li key={precedent}>{precedent}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-xs text-muted">
        <span>post {decision.post_id}</span>
        <span>model {decision.model}</span>
      </div>
    </div>
  )
})
DecisionCard.displayName = 'DecisionCard'
