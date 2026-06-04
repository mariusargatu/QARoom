import {
  AdvanceRolloutRequest,
  asOf,
  CommunityId,
  FlagKey,
  FlagList,
  FlagResolution,
  rolloutEnabled,
} from '@qaroom/contracts'
import { problem, withIdempotency } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from './deps'
import { advanceRollout, listFlags, resolveFlag } from './repository'

const ADVANCE_ROUTE = 'POST /api/communities/{communityId}/flags/{flagKey}/rollout'

export function registerFlagRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // Resolve a single flag's current value.
  app.get<{ Params: { communityId: string; flagKey: string } }>(
    '/api/communities/:communityId/flags/:flagKey',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const flagKey = FlagKey.parse(req.params.flagKey)
      const record = await resolveFlag(deps.db, communityId, flagKey)
      reply
        .code(200)
        .send(FlagResolution.parse({ ...record, as_of: asOf(deps.clock, deps.lamport) }))
    },
  )

  // List every flag resolved for a community.
  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/flags',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const records = await listFlags(deps.db, communityId)
      const at = asOf(deps.clock, deps.lamport)
      reply.code(200).send(
        FlagList.parse({
          community_id: communityId,
          flags: records.map((r) => ({ ...r, as_of: at })),
          as_of: at,
        }),
      )
    },
  )

  // Advance a flag's rollout by one event. Idempotent on Idempotency-Key; an event illegal
  // from the current state is a 409 (the machine, not the handler, decides legality).
  app.post<{ Params: { communityId: string; flagKey: string } }>(
    '/api/communities/:communityId/flags/:flagKey/rollout',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const flagKey = FlagKey.parse(req.params.flagKey)
      const body = AdvanceRolloutRequest.parse(req.body)
      await withIdempotency(
        req,
        reply,
        { db: deps.db, clock: deps.clock, route: ADVANCE_ROUTE, status: 200 },
        async () => {
          const outcome = await advanceRollout(deps.db, deps, communityId, flagKey, body.event)
          if (!outcome.changed) {
            throw problem({
              slug: 'rollout-transition-illegal',
              title: 'Illegal rollout transition',
              status: 409,
              failure_domain: 'conflict',
              detail: `Event ${body.event} is not legal from state ${outcome.from}.`,
              next_actions: [
                {
                  verb: 'GET',
                  href: `/api/communities/${communityId}/flags/${flagKey}`,
                  description: 'Inspect the current rollout state before advancing.',
                },
              ],
            })
          }
          // `advanceRollout` already committed and returned the new state — reconstruct the
          // response from it instead of a second `resolveFlag` round-trip on this write path.
          return FlagResolution.parse({
            community_id: communityId,
            flag_key: flagKey,
            state: outcome.to,
            enabled: rolloutEnabled(outcome.to),
            as_of: asOf(deps.clock, deps.lamport),
          })
        },
      )
    },
  )
}
