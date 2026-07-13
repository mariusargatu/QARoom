import {
  CommunityId,
  CreateDonationRequest,
  Donation,
  DonationId,
  DonationList,
} from '@qaroom/contracts'
import { problem, withIdempotency } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../deps'
import { createDonation, getDonation, listDonations } from '../repository'

const CREATE_ROUTE = 'POST /api/communities/{communityId}/donations'

export function registerDonationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // Create a donation — gated by the `donations` feature flag (Milestone 5).
  app.post<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/donations',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const body = CreateDonationRequest.parse(req.body)
      await withIdempotency(
        req,
        reply,
        { db: deps.db, clock: deps.clock, route: CREATE_ROUTE, status: 201 },
        async () => {
          const result = await createDonation(deps.db, deps, {
            communityId,
            donorId: body.donor_id,
            amountCents: body.amount_cents,
            currency: body.currency,
            idempotencyKey: String(req.headers['idempotency-key']),
          })
          if (!result.ok && result.reason === 'gated') {
            throw problem({
              slug: 'donations-not-enabled',
              title: 'Donations are not enabled',
              status: 409,
              failure_domain: 'conflict',
              detail: `The donations feature is not enabled for community ${communityId}.`,
              next_actions: [
                {
                  verb: 'GET',
                  href: `/api/communities/${communityId}/flags/donations`,
                  description: 'Check the donations rollout state for this community.',
                },
              ],
            })
          }
          if (!result.ok) {
            throw problem({
              slug: 'payment-provider-unavailable',
              title: 'Payment provider unavailable',
              status: 502,
              failure_domain: 'dependency_failure',
              retryable: true,
              detail: 'The payment provider could not be reached. Retry shortly.',
            })
          }
          return Donation.parse(result.donation)
        },
      )
    },
  )

  // Fetch a single donation (tenant-scoped: a donation in another community 404s).
  app.get<{ Params: { communityId: string; donationId: string } }>(
    '/api/communities/:communityId/donations/:donationId',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const donationId = DonationId.parse(req.params.donationId)
      const record = await getDonation(deps.db, donationId)
      if (!record || record.community_id !== communityId) {
        throw problem({
          slug: 'donation-not-found',
          title: 'Donation not found',
          status: 404,
          failure_domain: 'not_found',
          detail: `No donation with id ${donationId} in this community.`,
        })
      }
      reply.code(200).send(Donation.parse(record))
    },
  )

  // List a community's donations, newest first.
  app.get<{ Params: { communityId: string } }>(
    '/api/communities/:communityId/donations',
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const records = await listDonations(deps.db, communityId)
      reply.code(200).send(DonationList.parse({ community_id: communityId, donations: records }))
    },
  )
}
