import { CastVoteRequest, CommunityId, CreatePostRequest, PostId } from '@qaroom/contracts'
import { idempotencyKeyFrom, problem } from '@qaroom/service-kit'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ClientResponse } from './content-client'
import type { GatewayRouteDeps } from './deps'

/** Call the upstream, map an unreachable upstream to a 502, passthrough otherwise. */
async function forward(
  reply: FastifyReply,
  deps: GatewayRouteDeps,
  mutating: boolean,
  call: () => Promise<ClientResponse>,
): Promise<void> {
  let result: ClientResponse
  try {
    result = await call()
  } catch {
    throw problem({
      slug: 'content-unreachable',
      title: 'Upstream content-service unavailable',
      status: 502,
      failure_domain: 'dependency_failure',
      detail: 'content-service did not respond.',
      retryable: true,
      next_actions: [
        { verb: 'GET', href: '/system/state', description: 'Check gateway and upstream status.' },
      ],
    })
  }
  if (mutating && result.status >= 200 && result.status < 300) deps.lamport.bump()
  reply.code(result.status)
  if (result.contentType) reply.header('content-type', result.contentType)
  reply.send(result.body)
}

export function registerProxyRoutes(app: FastifyInstance, deps: GatewayRouteDeps): void {
  app.post<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/posts',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const key = idempotencyKeyFrom(req)
      const body = CreatePostRequest.parse(req.body)
      await forward(reply, deps, true, () => deps.content.createPost(communityId, body, key))
    },
  )

  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/feed',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      await forward(reply, deps, false, () => deps.content.getFeed(communityId))
    },
  )

  app.get<{ Params: { postId: string } }>('/api/posts/:postId', async (req, reply) => {
    const postId = PostId.parse(req.params.postId)
    await forward(reply, deps, false, () => deps.content.getPost(postId))
  })

  app.post<{ Params: { postId: string } }>('/api/posts/:postId/votes', async (req, reply) => {
    const postId = PostId.parse(req.params.postId)
    const key = idempotencyKeyFrom(req)
    const body = CastVoteRequest.parse(req.body)
    await forward(reply, deps, true, () => deps.content.castVote(postId, body, key))
  })
}
