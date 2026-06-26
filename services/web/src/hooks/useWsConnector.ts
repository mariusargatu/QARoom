import { useMemo } from 'react'
import type { ApiClient } from '../api/client'
import { connectWs } from '../ws/client'
import type { StreamConnector } from './useWsWithPollingFallback'

/**
 * Build a WebSocket connector for the activity feed (Commitment 11): mint a one-use ticket via the
 * gateway (`createWsTicket`, bearer-authed) then open the socket. Returns `undefined` without a
 * token — the feed then polls only, with full parity. The WS base derives from the API base URL
 * (or the page origin when same-origin), since a relative `/ws` is not a valid WebSocket URL.
 */
export function useWsConnector(
  api: ApiClient,
  baseUrl: string,
  token: string | null,
  communityId: string,
): StreamConnector | undefined {
  return useMemo(() => {
    if (!token) return undefined
    // The `: ''` arm is the SSR/no-window fallback; this browser-only hook runs under real Chromium,
    // so `typeof window === 'undefined'` is unreachable here — defensive only.
    const httpBase =
      baseUrl ||
      (typeof window !== 'undefined'
        ? window.location.origin
        : /* v8 ignore next -- SSR fallback unreachable in a browser-only hook */ '')
    return (handlers) => {
      let disconnect = () => {}
      let cancelled = false
      void api
        .createWsTicket(token)
        .then((ticket) => {
          if (!cancelled) disconnect = connectWs(httpBase, communityId, ticket.ticket, handlers)
        })
        .catch(() => {
          /* the polling fallback already covers this — no live socket */
        })
      return () => {
        cancelled = true
        disconnect()
      }
    }
  }, [api, baseUrl, token, communityId])
}
