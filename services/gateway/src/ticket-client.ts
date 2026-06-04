import { RedeemTicketResponse } from '@qaroom/contracts'

/**
 * Client the gateway uses to redeem a WebSocket ticket against identity-service before
 * upgrading a connection (ADR-0013). Injectable seam (like `content-client.ts`); tests pass a
 * stub. A 401 from identity (unknown/expired/used ticket) surfaces as `null`; any other
 * non-2xx is a provider fault and throws.
 */
export interface TicketClient {
  redeem(ticket: string): Promise<RedeemTicketResponse | null>
}

export function createTicketClient(
  identityBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): TicketClient {
  const base = identityBaseUrl.replace(/\/$/, '')
  return {
    async redeem(ticket) {
      const res = await fetchImpl(`${base}/ws/tickets/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket }),
      })
      if (res.status === 401) return null
      if (!res.ok) throw new Error(`identity ticket redeem returned ${res.status}`)
      return RedeemTicketResponse.parse(await res.json())
    },
  }
}
