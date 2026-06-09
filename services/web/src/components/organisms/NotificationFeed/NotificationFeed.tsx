import type { WsEnvelope } from '@qaroom/contracts'
import { TESTID } from '@qaroom/testing-utils/testids'
import { forwardRef } from 'react'
import { Badge } from '../../atoms/Badge'

export interface NotificationFeedProps {
  events: readonly WsEnvelope[]
  /** True while connected over WebSocket; false when on the polling fallback. */
  live?: boolean
}

function describe(event: WsEnvelope): string {
  if (event.type === 'flag.state.changed') {
    return `Flag "${event.flag_key}" → ${event.state}`
  }
  return `Donation ${event.status} (${event.amount_cents / 100} ${event.currency})`
}

/** Organism: a live feed of WS push envelopes (falls back to polling — same envelopes). */
export const NotificationFeed = forwardRef<HTMLElement, NotificationFeedProps>(
  function NotificationFeed({ events, live = true }, ref) {
    return (
      <section ref={ref} aria-label="Activity" data-testid={TESTID.notificationFeed}>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-display text-lg font-medium text-text">Activity</h2>
          <Badge tone={live ? 'success' : 'warning'}>{live ? 'live' : 'polling'}</Badge>
        </div>
        {events.length === 0 ? (
          <p className="py-6 text-sm text-muted">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border text-sm text-text">
            {events.map((event) => (
              <li key={`${event.type}-${event.seq}`} className="py-4">
                {describe(event)}
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  },
)
NotificationFeed.displayName = 'NotificationFeed'
