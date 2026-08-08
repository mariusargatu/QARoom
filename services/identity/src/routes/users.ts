import { CreateUserRequest, User, UserErasureAccepted, UserId } from '@qaroom/contracts'
import { withIdempotency } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../deps'
import { createUser, eraseUser, getUser } from '../repository'
import { handleTakenProblem, userNotFoundProblem } from './problems'

const CREATE_ROUTE = 'POST /api/users'
const ERASE_ROUTE = 'DELETE /api/users/{userId}'

export function registerUserRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/users', async (req, reply) => {
    const body = CreateUserRequest.parse(req.body)
    await withIdempotency(
      req,
      reply,
      { db: deps.db, clock: deps.clock, route: CREATE_ROUTE, status: 201 },
      async () => {
        const record = await createUser(deps.db, deps, {
          handle: body.handle,
          displayName: body.display_name,
        })
        // A taken handle is a CONFLICT the caller can act on, not an internal error. It previously
        // escaped as a 500 with `retryable: true`, which told the user to retry a request that could
        // never succeed and gave the UI nothing to render but "An unexpected error occurred."
        if (!record) throw handleTakenProblem(body.handle)
        return User.parse(record)
      },
    )
  })

  app.get<{ Params: { userId: string } }>('/api/users/:userId', async (req, reply) => {
    const userId = UserId.parse(req.params.userId)
    const record = await getUser(deps.db, userId)
    if (!record) throw userNotFoundProblem(userId)
    reply.code(200).send(User.parse(record))
  })

  // GDPR right-to-erasure (ADR-0036). Mutating + idempotent on the Idempotency-Key. Returns 202:
  // identity has deleted its own user data and staged one `user.erased` per community on the outbox;
  // the cross-service cascade (content, donations) settles asynchronously via the relay + consumers.
  // A 404 (no such user) propagates from `produce` BEFORE the response is stored, so a missing user
  // is never cached as an accepted erasure.
  app.delete<{ Params: { userId: string } }>('/api/users/:userId', async (req, reply) => {
    const userId = UserId.parse(req.params.userId)
    await withIdempotency(
      req,
      reply,
      { db: deps.db, clock: deps.clock, route: ERASE_ROUTE, status: 202 },
      async () => {
        const result = await eraseUser(deps.db, deps, userId)
        if (!result) throw userNotFoundProblem(userId)
        return UserErasureAccepted.parse({
          saga_id: result.sagaId,
          user_id: userId,
          status: 'Cascading',
          communities: result.communities,
        })
      },
    )
  })
}
