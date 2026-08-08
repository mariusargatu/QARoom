import { WsEnvelope } from '@qaroom/contracts'

/**
 * Open an authenticated WebSocket to the gateway and stream `WsEnvelope`s. The ticket is
 * presented in the subprotocol as `ticket.<ticket>` (ADR-0013). Returns a disconnect function.
 * Falls back to polling is the caller's concern (see `useWsWithPollingFallback`).
 */
export function connectWs(
  baseUrl: string,
  communityId: string,
  ticket: string,
  handlers: { onEvent: (event: WsEnvelope) => void; onOpen?: () => void; onClose?: () => void },
): () => void {
  const url = `${baseUrl.replace(/^http/, 'ws')}/ws?community=${communityId}`
  const socket = new WebSocket(url, [`ticket.${ticket}`])
  socket.addEventListener('open', () => handlers.onOpen?.())
  socket.addEventListener('close', () => handlers.onClose?.())
  socket.addEventListener('message', (event) => {
    // `safeParse` guards the SHAPE but not the decode: `JSON.parse` throws on a non-JSON or binary
    // frame, and a throw inside a listener is an uncaught error, not a rejected promise — one
    // malformed frame from the socket takes out the handler. The frame is untrusted input; treat a
    // decode failure the same way as a shape failure, by ignoring it.
    let raw: unknown
    try {
      raw = JSON.parse(String(event.data))
    } catch {
      return
    }
    const parsed = WsEnvelope.safeParse(raw)
    if (parsed.success) handlers.onEvent(parsed.data)
  })
  return () => socket.close()
}
