import { CommunityId, Feed } from '@qaroom/contracts'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from './deps'
import { listFeed } from './repository'

export function registerFeedRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/feed',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const records = await listFeed(deps.db, communityId)
      const tick = deps.lamport.read()
      const feed = Feed.parse({
        community_id: communityId,
        posts: records,
        as_of: {
          snapshot_id: tick.snapshot_id,
          lamport: tick.lamport,
          wall_clock: deps.clock.now().toISOString(),
        },
      })
      reply.code(200).send(feed)
    },
  )
}
