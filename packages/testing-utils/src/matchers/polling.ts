import { WsEnvelope } from '@qaroom/contracts'

/**
 * WebSocket ↔ polling parity matcher (Commitment 11). Every event delivered over the WS push
 * path must also be retrievable from the polling endpoint for the same window, so a client
 * without WS support is never blind to an event. This asserts the two sequences, once each is
 * parsed through the `WsEnvelope` contract and ordered by `seq`, are identical.
 *
 * Comparing by `seq` (the per-community monotonic cursor) and then deep-equality catches the
 * three ways the paths can drift: a missing event, an extra event, or a payload that differs
 * between transports.
 */
export function expectWsEventMatchesPolling(wsEvents: unknown[], polledEvents: unknown[]): void {
  const ws = parseAndSort(wsEvents, 'WS')
  const polled = parseAndSort(polledEvents, 'polling')

  if (ws.length !== polled.length) {
    throw new Error(
      `WS/polling parity broken: WS delivered ${ws.length} events, polling returned ${polled.length}`,
    )
  }
  for (let i = 0; i < ws.length; i++) {
    const a = JSON.stringify(ws[i])
    const b = JSON.stringify(polled[i])
    if (a !== b) {
      throw new Error(
        `WS/polling parity broken at seq ${ws[i]?.seq}:\n  WS:      ${a}\n  polling: ${b}`,
      )
    }
  }
}

function parseAndSort(events: unknown[], label: string): WsEnvelope[] {
  return events
    .map((e, i) => {
      const parsed = WsEnvelope.safeParse(e)
      if (!parsed.success) {
        throw new Error(`${label} event[${i}] is not a valid WsEnvelope: ${parsed.error.message}`)
      }
      return parsed.data
    })
    .sort((x, y) => x.seq - y.seq)
}
