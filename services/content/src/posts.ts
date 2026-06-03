import { CommunityId, CreatePostRequest, Post, PostId } from '@qaroom/contracts'
import { idempotencyKeyFrom, problem } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from './deps'
import { bodyHash } from './idempotency'
import { createPost, findIdempotent, getPost, storeIdempotent } from './repository'

const CREATE_ROUTE = 'POST /api/communities/{communityId}/posts'

export function registerPostRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/posts',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const key = idempotencyKeyFrom(req)
      const body = CreatePostRequest.parse(req.body)
      const hash = bodyHash(req.body)

      const replayed = await findIdempotent(deps.db, key, CREATE_ROUTE, hash)
      if (replayed) {
        reply.code(replayed.status).send(replayed.body)
        return
      }

      const record = await createPost(deps.db, deps, {
        communityId,
        authorId: body.author_id,
        title: body.title,
        body: body.body,
      })
      const response = Post.parse(record)
      await storeIdempotent(deps.db, deps, {
        key,
        route: CREATE_ROUTE,
        hash,
        status: 201,
        body: response,
      })
      reply.code(201).send(response)
    },
  )

  app.get<{ Params: { postId: string } }>('/api/posts/:postId', async (req, reply) => {
    const postId = PostId.parse(req.params.postId)
    const record = await getPost(deps.db, postId)
    if (!record) {
      throw problem({
        slug: 'post-not-found',
        title: 'Post not found',
        status: 404,
        failure_domain: 'not_found',
        detail: `No post with id ${postId}`,
        next_actions: [
          {
            verb: 'GET',
            href: '/api/communities/{communityId}/feed',
            description: 'Browse a community feed to find posts.',
          },
        ],
      })
    }
    reply.code(200).send(Post.parse(record))
  })
}
