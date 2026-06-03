import { CreateUserRequest, User, UserId } from '@qaroom/contracts'
import { problem, withIdempotency } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../deps'
import { createUser, getUser } from '../repository'

const CREATE_ROUTE = 'POST /api/users'

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
        return User.parse(record)
      },
    )
  })

  app.get<{ Params: { userId: string } }>('/api/users/:userId', async (req, reply) => {
    const userId = UserId.parse(req.params.userId)
    const record = await getUser(deps.db, userId)
    if (!record) {
      throw problem({
        slug: 'user-not-found',
        title: 'User not found',
        status: 404,
        failure_domain: 'not_found',
        detail: `No user with id ${userId}`,
        next_actions: [{ verb: 'POST', href: '/api/users', description: 'Create a user.' }],
      })
    }
    reply.code(200).send(User.parse(record))
  })
}
