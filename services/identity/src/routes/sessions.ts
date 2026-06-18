import { AccessTokenResponse, CreateSessionRequest, MembershipClaim } from '@qaroom/contracts'
import { dateFromEpochMillis } from '@qaroom/determinism'
import { withIdempotency } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../deps'
import { getUser, membershipsForUser, recordSession } from '../repository'
import { userNotFoundProblem } from './problems'

const CREATE_ROUTE = 'POST /api/sessions'

export function registerSessionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/sessions', async (req, reply) => {
    const body = CreateSessionRequest.parse(req.body)
    await withIdempotency(
      req,
      reply,
      { db: deps.db, clock: deps.clock, route: CREATE_ROUTE, status: 201 },
      async () => {
        const user = await getUser(deps.db, body.user_id)
        if (!user) throw userNotFoundProblem(body.user_id)

        const memberships = await membershipsForUser(deps.db, body.user_id)
        const claims = memberships.map((m) =>
          MembershipClaim.parse({ community_id: m.community_id, role: m.role }),
        )
        const issued = await deps.issuer.issue({ sub: body.user_id, memberships: claims })

        const issuedAt = deps.clock.now()
        // `issued.exp` is JWT NumericDate (seconds), already derived from the injected clock.
        const expiresAt = dateFromEpochMillis(issued.exp * 1000)

        const sessionId = deps.ids.next('sess')
        await recordSession(deps.db, {
          id: sessionId,
          userId: body.user_id,
          kid: issued.kid,
          issuedAt,
          expiresAt,
        })
        deps.lamport.bump()

        return AccessTokenResponse.parse({
          session_id: sessionId,
          access_token: issued.token,
          token_type: 'Bearer',
          expires_at: expiresAt.toISOString(),
          kid: issued.kid,
        })
      },
    )
  })
}
