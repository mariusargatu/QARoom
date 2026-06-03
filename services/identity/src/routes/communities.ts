import {
  AddMembershipRequest,
  asOf,
  Community,
  CommunityId,
  CreateCommunityRequest,
  MemberList,
  Membership,
} from '@qaroom/contracts'
import { idempotencyKeyFrom, problem } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../deps'
import { bodyHash } from '../idempotency'
import {
  addMembership,
  createCommunity,
  findIdempotent,
  listMembers,
  storeIdempotent,
} from '../repository'

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
    const key = idempotencyKeyFrom(req)
    const body = CreateCommunityRequest.parse(req.body)
    const hash = bodyHash(req.body)

    const replayed = await findIdempotent(deps.db, key, CREATE_COMMUNITY_ROUTE, hash)
    if (replayed) {
      reply.code(replayed.status).send(replayed.body)
      return
    }

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
    const response = Community.parse(record)
    await storeIdempotent(deps.db, deps, {
      key,
      route: CREATE_COMMUNITY_ROUTE,
      hash,
      status: 201,
      body: response,
    })
    reply.code(201).send(response)
  })

  app.post<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/members',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const key = idempotencyKeyFrom(req)
      const body = AddMembershipRequest.parse(req.body)
      const hash = bodyHash(req.body)
      const route = `POST /api/communities/${communityId}/members`

      const replayed = await findIdempotent(deps.db, key, route, hash)
      if (replayed) {
        reply.code(replayed.status).send(replayed.body)
        return
      }

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
      const response = Membership.parse(result.membership)
      await storeIdempotent(deps.db, deps, { key, route, hash, status: 201, body: response })
      reply.code(201).send(response)
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
