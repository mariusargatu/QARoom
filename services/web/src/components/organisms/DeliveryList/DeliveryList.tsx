import type { WebhookDelivery, WebhookDeliveryStatus } from '@qaroom/contracts'
import { forwardRef } from 'react'
import { formatDateTime } from '../../../lib/format'
import { Badge, type BadgeTone } from '../../atoms/Badge'
import { Skeleton } from '../../atoms/Skeleton'

export interface DeliveryListProps {
  deliveries: WebhookDelivery[]
  loading?: boolean
}

const STATUS_TONE: Record<WebhookDeliveryStatus, BadgeTone> = {
  Pending: 'neutral',
  Delivering: 'primary',
  Delivered: 'success',
  Retrying: 'warning',
  DeadLettered: 'danger',
}

/** Organism: the per-subscription delivery ledger — the observable retry contract. */
export const DeliveryList = forwardRef<HTMLDivElement, DeliveryListProps>(function DeliveryList(
  { deliveries, loading = false },
  ref,
) {
  if (loading) {
    return (
      <div ref={ref} className="divide-y divide-border border-t border-border" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="py-4">
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    )
  }
  if (deliveries.length === 0) {
    return (
      <div ref={ref} className="border-t border-border py-16 text-center">
        <p className="font-display text-xl text-text">No deliveries yet</p>
        <p className="mt-1 text-sm text-muted">Deliveries appear as events fire.</p>
      </div>
    )
  }
  return (
    <div ref={ref} className="divide-y divide-border border-t border-border">
      {deliveries.map((delivery) => (
        <div key={delivery.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4 text-sm">
          <Badge tone={STATUS_TONE[delivery.status]}>{delivery.status}</Badge>
          <span className="font-medium text-text">{delivery.event_type}</span>
          <span className="text-muted tabular-nums">attempt {delivery.attempt}</span>
          {delivery.last_status_code !== null ? (
            <span className="text-muted tabular-nums">HTTP {delivery.last_status_code}</span>
          ) : null}
          {delivery.next_attempt_at ? (
            <span className="text-muted">next {formatDateTime(delivery.next_attempt_at)}</span>
          ) : null}
          <span className="ml-auto text-xs text-muted">{formatDateTime(delivery.updated_at)}</span>
        </div>
      ))}
    </div>
  )
})
DeliveryList.displayName = 'DeliveryList'
