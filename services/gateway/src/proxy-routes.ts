import { CastVoteRequest, CommunityId, CreatePostRequest, PostId } from '@qaroom/contracts'
import { idempotencyKeyFrom } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { GatewayRouteDeps } from './deps'
import { forward, type Upstream } from './forward'
import { CONTENT_UPSTREAM, upstreamTitle } from './upstreams'

const CONTENT: Upstream = {
  slug: CONTENT_UPSTREAM.slug,
  title: upstreamTitle(CONTENT_UPSTREAM.service),
  detail: 'content-service did not respond.',
}

export function registerProxyRoutes(app: FastifyInstance, deps: GatewayRouteDeps): void {
  app.post<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/posts',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const key = idempotencyKeyFrom(req)
      const body = CreatePostRequest.parse(req.body)
      await forward(reply, deps, true, CONTENT, () =>
        deps.content.createPost(communityId, body, key),
      )
    },
  )

  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/feed',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      await forward(reply, deps, false, CONTENT, () => deps.content.getFeed(communityId))
    },
  )

  app.get<{ Params: { postId: string } }>('/api/posts/:postId', async (req, reply) => {
    const postId = PostId.parse(req.params.postId)
    await forward(reply, deps, false, CONTENT, () => deps.content.getPost(postId))
  })

  app.post<{ Params: { postId: string } }>('/api/posts/:postId/votes', async (req, reply) => {
    const postId = PostId.parse(req.params.postId)
    const key = idempotencyKeyFrom(req)
    const body = CastVoteRequest.parse(req.body)
    await forward(reply, deps, true, CONTENT, () => deps.content.castVote(postId, body, key))
  })
}
