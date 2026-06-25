import { CommunityId, ModerationDecisionId } from '@qaroom/contracts'
import type { FastifyInstance } from 'fastify'
import type { GatewayRouteDeps } from './deps'
import { forward, type Upstream } from './forward'
import type { ModeratorClient } from './moderator-client'
import { MODERATOR_UPSTREAM, upstreamTitle } from './upstreams'

const MODERATOR: Upstream = {
  slug: MODERATOR_UPSTREAM.slug,
  title: upstreamTitle(MODERATOR_UPSTREAM.service),
  detail: 'moderator-agent did not respond (timed out or refused).',
}

/** Proxy the moderator-agent decision reads so the web frontend can render a moderation dashboard. */
export function registerModerationRoutes(
  app: FastifyInstance,
  deps: GatewayRouteDeps,
  moderator: ModeratorClient,
): void {
  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/moderation-decisions',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      await forward(reply, deps, false, MODERATOR, () => moderator.listDecisions(communityId))
    },
  )

  app.get<{ Params: { communityId: string; decisionId: string } }>(
    '/api/communities/:communityId/moderation-decisions/:decisionId',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const decisionId = ModerationDecisionId.parse(req.params.decisionId)
      await forward(reply, deps, false, MODERATOR, () =>
        moderator.getDecision(communityId, decisionId),
      )
    },
  )
}
