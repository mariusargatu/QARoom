import {
  AddMembershipRequest,
  asOf,
  Community,
  CommunityId,
  CreateCommunityRequest,
  MemberList,
  Membership,
} from '@qaroom/contracts'
import { problem, withIdempotency } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../deps'
import { addMembership, createCommunity, listMembers } from '../repository'

const CREATE_COMMUNITY_ROUTE = 'POST /api/communities'

function communityNotFound(communityId: string) {
  return problem({
    slug: 'community-not-found',
    title: 'Community not found',
    status: 404,
    failure_domain: 'tenant_resolution',
    detail: `No community with id ${communityId}`,
    next_actions: [
      { verb: 'POST', href: '/api/communities', description: 'Create the community first.' },
    ],
  })
}

export function registerCommunityRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/communities', async (req, reply) => {
    const body = CreateCommunityRequest.parse(req.body)
    await withIdempotency(
      req,
      reply,
      { db: deps.db, clock: deps.clock, route: CREATE_COMMUNITY_ROUTE, status: 201 },
      async () => {
        const record = await createCommunity(deps.db, deps, { slug: body.slug, name: body.name })
        if (!record) {
          throw problem({
            slug: 'community-slug-taken',
            title: 'Community slug already taken',
            status: 409,
            failure_domain: 'conflict',
            detail: `A community with slug "${body.slug}" already exists.`,
          })
        }
        return Community.parse(record)
      },
    )
  })

  app.post<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/members',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const body = AddMembershipRequest.parse(req.body)
      const route = `POST /api/communities/${communityId}/members`
      await withIdempotency(
        req,
        reply,
        { db: deps.db, clock: deps.clock, route, status: 201 },
        async () => {
          const result = await addMembership(deps.db, deps, communityId, body.user_id, body.role)
          if ('error' in result) {
            if (result.error === 'community-not-found') throw communityNotFound(communityId)
            throw problem({
              slug: 'membership-exists',
              title: 'Membership already exists',
              status: 409,
              failure_domain: 'conflict',
              detail: `User ${body.user_id} already belongs to community ${communityId}.`,
            })
          }
          return Membership.parse(result.membership)
        },
      )
    },
  )

  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/members',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const records = await listMembers(deps.db, communityId)
      if (records === null) throw communityNotFound(communityId)
      reply.code(200).send(
        MemberList.parse({
          community_id: communityId,
          members: records,
          as_of: asOf(deps.clock, deps.lamport),
        }),
      )
    },
  )
}
