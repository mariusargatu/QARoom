import { AdvanceRolloutRequest, CommunityId, FlagKey } from '@qaroom/contracts'
import { idempotencyKeyFrom } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { GatewayRouteDeps } from './deps'
import type { FlagsClient } from './flags-client'
import { forward, type Upstream } from './forward'

const FLAGS: Upstream = {
  slug: 'flags-unreachable',
  title: 'Upstream flags-service unavailable',
  detail: 'flags-service did not respond (timed out or refused).',
}

/** Proxy the flags surface: resolve/list reads and the rollout-advance write. */
export function registerFlagsRoutes(
  app: FastifyInstance,
  deps: GatewayRouteDeps,
  flags: FlagsClient,
): void {
  app.get<{ Params: { communityId: string; flagKey: string } }>(
    '/api/communities/:communityId/flags/:flagKey',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const flagKey = FlagKey.parse(req.params.flagKey)
      await forward(reply, deps, false, FLAGS, () => flags.resolveFlag(communityId, flagKey))
    },
  )

  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/flags',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      await forward(reply, deps, false, FLAGS, () => flags.listFlags(communityId))
    },
  )

  app.post<{ Params: { communityId: string; flagKey: string } }>(
    '/api/communities/:communityId/flags/:flagKey/rollout',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const flagKey = FlagKey.parse(req.params.flagKey)
      const key = idempotencyKeyFrom(req)
      const body = AdvanceRolloutRequest.parse(req.body)
      await forward(reply, deps, true, FLAGS, () =>
        flags.advanceRollout(communityId, flagKey, body, key),
      )
    },
  )
}
