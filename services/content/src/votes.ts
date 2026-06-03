import { CastVoteRequest, CastVoteResponse, PostId } from '@qaroom/contracts'
import { idempotencyKeyFrom, problem } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from './deps'
import { bodyHash } from './idempotency'
import { castVote, findIdempotent, storeIdempotent } from './repository'

const VOTE_ROUTE = 'POST /api/posts/{postId}/votes'

export function registerVoteRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post<{ Params: { postId: string } }>('/api/posts/:postId/votes', async (req, reply) => {
    const postId = PostId.parse(req.params.postId)
    const key = idempotencyKeyFrom(req)
    const body = CastVoteRequest.parse(req.body)
    const hash = bodyHash(req.body)

    const replayed = await findIdempotent(deps.db, key, VOTE_ROUTE, hash)
    if (replayed) {
      reply.code(replayed.status).send(replayed.body)
      return
    }

    const score = await castVote(deps.db, deps, postId, body.voter_id, body.value)
    if (score === null) {
      throw problem({
        slug: 'post-not-found',
        title: 'Post not found',
        status: 404,
        failure_domain: 'not_found',
        detail: `No post with id ${postId}`,
        next_actions: [
          { verb: 'GET', href: `/api/posts/${postId}`, description: 'Confirm the post exists.' },
        ],
      })
    }

    const response = CastVoteResponse.parse({ post_id: postId, score, voter_value: body.value })
    await storeIdempotent(deps.db, deps, {
      key,
      route: VOTE_ROUTE,
      hash,
      status: 200,
      body: response,
    })
    reply.code(200).send(response)
  })
}
