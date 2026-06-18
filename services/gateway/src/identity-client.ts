import { boundCaller, type ClientResponse, type UpstreamClientOptions } from './upstream-call'

/**
 * The gateway's client for identity-service. A thin, bounded-timeout seam (the Pact consumer for
 * the gateway→identity contract), mirroring `flags-client.ts`. No circuit breaker: identity is on
 * the auth/bootstrap path, where the partition mitigation is just the upstream timeout → typed 502.
 *
 * `createWsTicket` forwards the caller's `Authorization` header verbatim — identity verifies the
 * JWT against its own JWKS (the gateway never decodes it). It is deliberately NOT idempotent: each
 * call mints a fresh, one-use ticket (ADR-0013), so no Idempotency-Key is sent.
 */
export interface IdentityClient {
  createUser(body: unknown, idempotencyKey: string): Promise<ClientResponse>
  getUser(userId: string): Promise<ClientResponse>
  createCommunity(body: unknown, idempotencyKey: string): Promise<ClientResponse>
  addMembership(communityId: string, body: unknown, idempotencyKey: string): Promise<ClientResponse>
  listMembers(communityId: string): Promise<ClientResponse>
  createSession(body: unknown, idempotencyKey: string): Promise<ClientResponse>
  createWsTicket(authorization: string | undefined): Promise<ClientResponse>
}

export function createIdentityClient(
  baseUrl: string,
  options: UpstreamClientOptions = {},
): IdentityClient {
  const call = boundCaller(baseUrl, options)
  return {
    createUser: (body, idempotencyKey) =>
      call({ method: 'POST', path: '/api/users', body, idempotencyKey }),
    getUser: (userId) => call({ method: 'GET', path: `/api/users/${userId}` }),
    createCommunity: (body, idempotencyKey) =>
      call({ method: 'POST', path: '/api/communities', body, idempotencyKey }),
    addMembership: (communityId, body, idempotencyKey) =>
      call({
        method: 'POST',
        path: `/api/communities/${communityId}/members`,
        body,
        idempotencyKey,
      }),
    listMembers: (communityId) =>
      call({ method: 'GET', path: `/api/communities/${communityId}/members` }),
    createSession: (body, idempotencyKey) =>
      call({ method: 'POST', path: '/api/sessions', body, idempotencyKey }),
    createWsTicket: (authorization) => call({ method: 'POST', path: '/ws/tickets', authorization }),
  }
}
