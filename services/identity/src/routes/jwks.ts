import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../deps'

/** `GET /jwks.json` (root path, public, unauthenticated): the JWKS-eligible verification keys. */
export function registerJwksRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/jwks.json', async (_req, reply) => {
    reply.code(200).send(await deps.keyStore.publishJwks())
  })
}
