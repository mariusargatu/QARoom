import { AccessTokenResponse, CreateSessionRequest, MembershipClaim } from '@qaroom/contracts'
import { idempotencyKeyFrom, problem } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../deps'
import { bodyHash } from '../idempotency'
import {
  findIdempotent,
  getUser,
  membershipsForUser,
  recordSession,
  storeIdempotent,
} from '../repository'

const CREATE_ROUTE = 'POST /api/sessions'

export function registerSessionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/sessions', async (req, reply) => {
    const key = idempotencyKeyFrom(req)
    const body = CreateSessionRequest.parse(req.body)
    const hash = bodyHash(req.body)

    const replayed = await findIdempotent(deps.db, key, CREATE_ROUTE, hash)
    if (replayed) {
      reply.code(replayed.status).send(replayed.body)
      return
    }

    const user = await getUser(deps.db, body.user_id)
    if (!user) {
      throw problem({
        slug: 'user-not-found',
        title: 'User not found',
        status: 404,
        failure_domain: 'not_found',
        detail: `No user with id ${body.user_id}`,
        next_actions: [{ verb: 'POST', href: '/api/users', description: 'Create the user first.' }],
      })
    }

    const memberships = await membershipsForUser(deps.db, body.user_id)
    const claims = memberships.map((m) =>
      MembershipClaim.parse({ community_id: m.community_id, role: m.role }),
    )
    const issued = await deps.issuer.issue({ sub: body.user_id, memberships: claims })

    const issuedAt = deps.clock.now()
    // Future expiry from logical time: copy the freshly-allocated clock instant and shift it.
    // No `new Date(...)` (Commitment 6) — `issued.exp` is already derived from the injected clock.
    const expiresAt = deps.clock.now()
    expiresAt.setTime(issued.exp * 1000)

    const sessionId = deps.ids.next('sess')
    await recordSession(deps.db, {
      id: sessionId,
      userId: body.user_id,
      kid: issued.kid,
      issuedAt,
      expiresAt,
    })
    deps.lamport.bump()

    const response = AccessTokenResponse.parse({
      session_id: sessionId,
      access_token: issued.token,
      token_type: 'Bearer',
      expires_at: expiresAt.toISOString(),
      kid: issued.kid,
    })
    await storeIdempotent(deps.db, deps, {
      key,
      route: CREATE_ROUTE,
      hash,
      status: 201,
      body: response,
    })
    reply.code(201).send(response)
  })
}
