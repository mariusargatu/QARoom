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
    const parsed = WsEnvelope.safeParse(JSON.parse(String(event.data)))
    if (parsed.success) handlers.onEvent(parsed.data)
  })
  return () => socket.close()
}
