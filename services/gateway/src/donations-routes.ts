import { CommunityId, CreateDonationRequest, DonationId } from '@qaroom/contracts'
import { idempotencyKeyFrom } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { GatewayRouteDeps } from './deps'
import type { DonationsClient } from './donations-client'
import { forward, type Upstream } from './forward'

const DONATIONS: Upstream = {
  slug: 'donations-unreachable',
  title: 'Upstream donations-service unavailable',
  detail: 'donations-service did not respond (timed out, refused, or the circuit is open).',
}

/** Proxy the donations surface, validated at the edge and forwarded through the breaker client. */
export function registerDonationsRoutes(
  app: FastifyInstance,
  deps: GatewayRouteDeps,
  donations: DonationsClient,
): void {
  app.post<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/donations',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const key = idempotencyKeyFrom(req)
      const body = CreateDonationRequest.parse(req.body)
      await forward(reply, deps, true, DONATIONS, () =>
        donations.createDonation(communityId, body, key),
      )
    },
  )

  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/donations',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      await forward(reply, deps, false, DONATIONS, () => donations.listDonations(communityId))
    },
  )

  app.get<{ Params: { communityId: string; donationId: string } }>(
    '/api/communities/:communityId/donations/:donationId',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const donationId = DonationId.parse(req.params.donationId)
      await forward(reply, deps, false, DONATIONS, () =>
        donations.getDonation(communityId, donationId),
      )
    },
  )
}
