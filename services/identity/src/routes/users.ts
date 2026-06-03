import { CreateUserRequest, User, UserId } from '@qaroom/contracts'
import { idempotencyKeyFrom, problem } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../deps'
import { bodyHash } from '../idempotency'
import { createUser, findIdempotent, getUser, storeIdempotent } from '../repository'

const CREATE_ROUTE = 'POST /api/users'

export function registerUserRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/users', async (req, reply) => {
    const key = idempotencyKeyFrom(req)
    const body = CreateUserRequest.parse(req.body)
    const hash = bodyHash(req.body)

    const replayed = await findIdempotent(deps.db, key, CREATE_ROUTE, hash)
    if (replayed) {
      reply.code(replayed.status).send(replayed.body)
      return
    }

    const record = await createUser(deps.db, deps, {
      handle: body.handle,
      displayName: body.display_name,
    })
    const response = User.parse(record)
    await storeIdempotent(deps.db, deps, {
      key,
      route: CREATE_ROUTE,
      hash,
      status: 201,
      body: response,
    })
    reply.code(201).send(response)
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
