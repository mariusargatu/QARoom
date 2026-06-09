import type { WebhookSubscription, WebhookSubscriptionStatus } from '@qaroom/contracts'
import { forwardRef } from 'react'
import { Badge, type BadgeTone } from '../../atoms/Badge'
import { Button } from '../../atoms/Button'
import { Skeleton } from '../../atoms/Skeleton'

export interface WebhookListProps {
  webhooks: WebhookSubscription[]
  loading?: boolean
  busyId?: string
  onPause: (id: string) => void
  onResume: (id: string) => void
  onDelete: (id: string) => void
  onViewDeliveries: (id: string) => void
}

const STATUS_TONE: Record<WebhookSubscriptionStatus, BadgeTone> = {
  Active: 'success',
  Paused: 'warning',
  Disabled: 'danger',
}

/** Organism: webhook subscriptions with their lifecycle actions (pause/resume/delete/deliveries). */
export const WebhookList = forwardRef<HTMLDivElement, WebhookListProps>(function WebhookList(
  { webhooks, loading = false, busyId, onPause, onResume, onDelete, onViewDeliveries },
  ref,
) {
  if (loading) {
    return (
      <div ref={ref} className="divide-y divide-border border-t border-border" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2 py-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    )
  }
  if (webhooks.length === 0) {
    return (
      <div ref={ref} className="border-t border-border py-16 text-center">
        <p className="font-display text-xl text-text">No webhooks yet</p>
        <p className="mt-1 text-sm text-muted">Register an endpoint above.</p>
      </div>
    )
  }
  return (
    <div ref={ref} className="divide-y divide-border border-t border-border">
      {webhooks.map((webhook) => {
        const busy = busyId === webhook.id
        return (
          <div key={webhook.id} className="flex flex-col gap-2 py-4">
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[webhook.status]}>{webhook.status}</Badge>
              <span className="min-w-0 flex-1 truncate text-sm text-text">{webhook.url}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {webhook.event_types.map((type) => (
                <Badge key={type} tone="neutral">
                  {type}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {webhook.status === 'Active' ? (
                <Button variant="ghost" disabled={busy} onClick={() => onPause(webhook.id)}>
                  Pause
                </Button>
              ) : webhook.status === 'Paused' ? (
                <Button variant="ghost" disabled={busy} onClick={() => onResume(webhook.id)}>
                  Resume
                </Button>
              ) : null}
              <Button variant="ghost" disabled={busy} onClick={() => onViewDeliveries(webhook.id)}>
                Deliveries
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => onDelete(webhook.id)}>
                Delete
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
})
WebhookList.displayName = 'WebhookList'
