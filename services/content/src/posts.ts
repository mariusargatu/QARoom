import { CommunityId, CreatePostRequest, Post, PostId } from '@qaroom/contracts'
import { problem, withIdempotency } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from './deps'
import { createPost, getPost } from './repository'

const CREATE_ROUTE = 'POST /api/communities/{communityId}/posts'

export function registerPostRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/posts',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const body = CreatePostRequest.parse(req.body)
      await withIdempotency(
        req,
        reply,
        { db: deps.db, clock: deps.clock, route: CREATE_ROUTE, status: 201 },
        async () => {
          const record = await createPost(deps.db, deps, {
            communityId,
            authorId: body.author_id,
            title: body.title,
            body: body.body,
          })
          return Post.parse(record)
        },
      )
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
