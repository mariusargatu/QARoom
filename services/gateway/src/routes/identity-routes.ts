import {
  AddMembershipRequest,
  CommunityId,
  CreateCommunityRequest,
  CreateSessionRequest,
  CreateUserRequest,
  UserId,
} from '@qaroom/contracts'
import { idempotencyKeyFrom } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { IdentityClient } from '../clients/identity-client'
import type { GatewayRouteDeps } from '../deps'
import { forward, type Upstream } from '../resilience/forward'
import { IDENTITY_UPSTREAM, upstreamTitle } from '../resilience/upstreams'

const IDENTITY: Upstream = {
  slug: IDENTITY_UPSTREAM.slug,
  title: upstreamTitle(IDENTITY_UPSTREAM.service),
  detail: 'identity-service did not respond (timed out or refused).',
}

/**
 * Proxy the identity surface so the web frontend can bootstrap an identity, communities, and
 * sessions same-origin (ADR-0022). Validated at the edge; forwarded through the timeout seam. The
 * gateway REST plane is unauthenticated by design (M2 deferred credentials) — see ADR-0022 — so
 * these are dumb passthroughs except `createWsTicket`, which forwards the bearer for identity to
 * verify against its own JWKS.
 */
export function registerIdentityRoutes(
  app: FastifyInstance,
  deps: GatewayRouteDeps,
  identity: IdentityClient,
): void {
  app.post('/api/users', async (req, reply) => {
    const key = idempotencyKeyFrom(req)
    const body = CreateUserRequest.parse(req.body)
    await forward(reply, deps, true, IDENTITY, () => identity.createUser(body, key))
  })

  app.get<{ Params: { userId: string } }>('/api/users/:userId', async (req, reply) => {
    const userId = UserId.parse(req.params.userId)
    await forward(reply, deps, false, IDENTITY, () => identity.getUser(userId))
  })

  app.post('/api/communities', async (req, reply) => {
    const key = idempotencyKeyFrom(req)
    const body = CreateCommunityRequest.parse(req.body)
    await forward(reply, deps, true, IDENTITY, () => identity.createCommunity(body, key))
  })

  app.post<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/members',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const key = idempotencyKeyFrom(req)
      const body = AddMembershipRequest.parse(req.body)
      await forward(reply, deps, true, IDENTITY, () =>
        identity.addMembership(communityId, body, key),
      )
    },
  )

  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/members',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      await forward(reply, deps, false, IDENTITY, () => identity.listMembers(communityId))
    },
  )

  app.post('/api/sessions', async (req, reply) => {
    const key = idempotencyKeyFrom(req)
    const body = CreateSessionRequest.parse(req.body)
    await forward(reply, deps, true, IDENTITY, () => identity.createSession(body, key))
  })

  // Mints a one-use WS handshake ticket. Not idempotent (ADR-0013); forwards the bearer verbatim.
  app.post('/ws/tickets', async (req, reply) => {
    await forward(reply, deps, false, IDENTITY, () =>
      identity.createWsTicket(req.headers.authorization),
    )
  })
}
