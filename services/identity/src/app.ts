import { LamportGate } from '@qaroom/contracts'
import { activeSpanSink, registerTenantContext } from '@qaroom/otel'
import {
  registerHealthRoutes,
  registerProblemHandler,
  registerSnapshotRoutes,
  registerSystemRoutes,
} from '@qaroom/service-kit'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { DEFAULT_TOKEN_TTL_SECONDS, type IdentityDeps, type RouteDeps } from './deps'
import { createIssuer, type Issuer } from './jwt'
import { KeyStore } from './keys'
import { OPERATIONS } from './operations'
import { countRows } from './repository'
import { registerCommunityRoutes } from './routes/communities'
import { registerJwksRoute } from './routes/jwks'
import { registerSessionRoutes } from './routes/sessions'
import { registerUserRoutes } from './routes/users'
import { registerWsTicketRoutes } from './routes/ws-tickets'
import { TicketStore } from './ticket-store'

export interface BuiltIdentity {
  app: FastifyInstance
  keyStore: KeyStore
  issuer: Issuer
}

/**
 * Build an identity-service Fastify instance plus the KeyStore and Issuer it wires. No
 * globals are read: clock, ids, randomness, db, and the KeyMaterialSource all arrive via
 * `deps` (Commitment 6). Returning the keyStore/issuer lets unit/property tests drive JWT
 * issuance and rotation directly. `buildApp` is the thin Fastify-only wrapper.
 */
export function buildIdentity(deps: IdentityDeps): BuiltIdentity {
  const lamport = deps.lamport ?? new LamportGate(deps.ids, deps.sink ?? activeSpanSink)
  const keyStore = new KeyStore(deps.db, deps.clock, deps.ids, deps.keyMaterial, deps.rotation)
  const issuer = createIssuer(
    keyStore,
    deps.clock,
    deps.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS,
  )
  const ticketStore = new TicketStore(deps.clock, deps.ids)
  const routeDeps: RouteDeps = {
    db: deps.db,
    clock: deps.clock,
    ids: deps.ids,
    randomness: deps.randomness,
    lamport,
    keyStore,
    issuer,
    ticketStore,
  }

  const app = Fastify({ logger: false })
  registerTenantContext(app)
  registerProblemHandler(app)
  registerHealthRoutes(app, {
    service: 'identity',
    readiness: async () => {
      await deps.db.execute(sql`select 1`)
    },
  })
  registerUserRoutes(app, routeDeps)
  registerCommunityRoutes(app, routeDeps)
  registerSessionRoutes(app, routeDeps)
  registerWsTicketRoutes(app, routeDeps)
  registerJwksRoute(app, routeDeps)
  registerSystemRoutes(app, {
    service: 'identity',
    clock: deps.clock,
    lamport,
    operations: OPERATIONS,
    models: async () => {
      const counts = await countRows(deps.db)
      const eligible = await keyStore.jwksEligible()
      const current = eligible.find((k) => k.status === 'current')
      return {
        users: { count: counts.users },
        communities: { count: counts.communities },
        memberships: { count: counts.memberships },
        sessions: { count: counts.sessions },
        signing_keys: {
          current_kid: current?.kid ?? null,
          previous_kids: eligible.filter((k) => k.status === 'previous').map((k) => k.kid),
          jwks_eligible_count: eligible.length,
          total_count: counts.keys,
          grace_ms: keyStore.graceMs,
        },
      }
    },
  })
  registerSnapshotRoutes(app, {
    service: 'identity',
    clock: deps.clock,
    lamport,
    store: deps.snapshotStore,
  })
  return { app, keyStore, issuer }
}

export function buildApp(deps: IdentityDeps): FastifyInstance {
  return buildIdentity(deps).app
}
