import { CastVoteRequest, CastVoteResponse, PostId } from '@qaroom/contracts'
import { problem, withIdempotency } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from './deps'
import { castVote } from './repository'

const VOTE_ROUTE = 'POST /api/posts/{postId}/votes'

export function registerVoteRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{ Params: { postId: string } }>('/api/posts/:postId/votes', async (req, reply) => {
    const postId = PostId.parse(req.params.postId)
    const body = CastVoteRequest.parse(req.body)
    await withIdempotency(
      req,
      reply,
      { db: deps.db, clock: deps.clock, route: VOTE_ROUTE, status: 200 },
      async () => {
        const score = await castVote(deps.db, deps, postId, body.voter_id, body.value)
        // A 404 must NOT be stored as an idempotent success — throwing here exits
        // withIdempotency before the store, so a retry re-evaluates against current state.
        if (score === null) {
          throw problem({
            slug: 'post-not-found',
            title: 'Post not found',
            status: 404,
            failure_domain: 'not_found',
            detail: `No post with id ${postId}`,
            next_actions: [
              {
                verb: 'GET',
                href: `/api/posts/${postId}`,
                description: 'Confirm the post exists.',
              },
            ],
          })
        }
        return CastVoteResponse.parse({ post_id: postId, score, voter_value: body.value })
      },
    )
  })
}
