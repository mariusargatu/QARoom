import type { WsEnvelope } from '@qaroom/contracts'
import { useEffect, useState } from 'react'
import type { ApiClient } from '../api/client'
import { messageFor } from '../lib/errors'

export interface UseEventFeed {
  events: WsEnvelope[]
  /** True while a WebSocket connection is open; false on the polling fallback. */
  live: boolean
  /**
   * Set when the POLL fails. Previously there was no error channel at all: a rejecting poll raised
   * an unhandled promise rejection every `intervalMs` forever while the UI showed an empty feed and
   * a reassuring badge, with nothing anywhere to say the fallback was dead.
   */
  error?: string
}

/** Connect to the push stream; matches `connectWs`'s handler shape. Returns a disconnect fn. */
export type StreamConnector = (handlers: {
  onEvent: (event: WsEnvelope) => void
  onOpen: () => void
  onClose: () => void
}) => () => void

export interface EventFeedOptions {
  intervalMs?: number
  /**
   * Optional WebSocket connector (e.g. `connectWs` bound to a redeemed ticket). When supplied,
   * `live` reflects the socket; when absent — the no-auth demo — the hook polls only and `live`
   * stays false. Either way the parity test guarantees both transports carry the same envelopes.
   */
  connect?: StreamConnector
  /**
   * The session access token. REQUIRED against a real gateway — ADR-0025 put the events route
   * behind edge auth, so a poll without it is a 401 and the Commitment-11 fallback silently
   * delivers nothing.
   */
  token?: string | null
}

export const FEED_CAP = 50

// WEB_BUG_WS_NO_DEDUP (deliberate-bug demo, in-proc only): drop the per-`seq` dedup so the WS push
// and the polling fallback both replay the backlog and the SAME envelope lands twice — duplicate
// React keys + doubled feed rows. `typeof process` is undefined in the browser bundle and the read
// is NODE_ENV-gated, so this can only ever arm under vitest/node, never in a deployed build. The
// `prepend` dedup property test goes red when it is set (detection-matrix toggle `ws-no-dedup`).
const dedupDisabled = (): boolean =>
  typeof process !== 'undefined' &&
  process.env.NODE_ENV !== 'production' &&
  process.env.WEB_BUG_WS_NO_DEDUP === '1'

// Merge newest-first, capped, deduped by per-community `seq` (monotonic + unique per community,
// which this hook is scoped to). Without the dedup, the WS push and the polling fallback both
// replay the same backlog (poll from cursor 0, socket with no `after`), so an envelope would
// appear twice — duplicate React keys + duplicated feed rows. WS<->polling parity is "same set",
// not the union of both transports. Exported for the merge-dedup unit + property tests.
export const prepend = (prev: WsEnvelope[], incoming: WsEnvelope[]): WsEnvelope[] => {
  const seen = new Set(dedupDisabled() ? [] : prev.map((e) => e.seq))
  const fresh = incoming.filter((e) => !seen.has(e.seq))
  // ORDER BY seq, not by arrival. Positional concatenation renders the feed in the order envelopes
  // happened to reach us, which is wrong in exactly the case the fallback exists for: the socket
  // delivers seq 7 but drops seq 6, then a poll backfills 6 — prepending puts the OLDER event above
  // the newer one in a feed labelled "newest first". `seq` is monotonic and unique per community,
  // which this hook is scoped to, so it is a total order over the merged set.
  return [...fresh, ...prev].sort((a, b) => b.seq - a.seq).slice(0, FEED_CAP)
}

/**
 * The activity feed with the Commitment-11 polling fallback. Polling always runs (the fallback,
 * and what the demo uses); a WebSocket layers on top when a `connect` capability is provided,
 * and `live` then reflects the real socket state rather than a constant.
 */
export function useWsWithPollingFallback(
  api: ApiClient,
  communityId: string,
  opts: EventFeedOptions = {},
): UseEventFeed {
  const { intervalMs = 2000, connect, token } = opts
  const [events, setEvents] = useState<WsEnvelope[]>([])
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cursor = 0
    let active = true

    const poll = async () => {
      try {
        const page = await api.listEvents(communityId, cursor, token ?? undefined)
        if (!active) return
        setError(undefined)
        if (page.events.length === 0) return
        cursor = page.cursor
        setEvents((prev) => prepend(prev, page.events))
      } catch (err) {
        // Caught, not swallowed: without this the rejection escapes `void poll()` as an unhandled
        // promise rejection on every tick, forever, and the user sees an empty feed with no reason.
        if (active) setError(messageFor(err))
      }
    }

    void poll()
    const id = setInterval(() => {
      void poll()
    }, intervalMs)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [api, communityId, intervalMs, token])

  useEffect(() => {
    if (!connect) return
    const disconnect = connect({
      onEvent: (event) => setEvents((prev) => prepend(prev, [event])),
      onOpen: () => setLive(true),
      onClose: () => setLive(false),
    })
    return () => {
      disconnect()
      setLive(false)
    }
  }, [connect])

  return { events, live, error }
}
