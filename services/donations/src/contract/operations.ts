import {
  brandedPathParam,
  communityIdParam,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_DONATION,
  EXAMPLE_USER_ID,
  idempotencyKeyHeaderParam,
  type OasOperation,
  problemResponse,
  SYSTEM_OPERATIONS,
  validationFailed,
} from '@qaroom/contracts'

/**
 * The canonical operation registry for donations-service. Single source for the committed
 * `openapi.yaml`, the `/system/capabilities` response, and the capabilities completeness test.
 */
const DONATION_INSTANCE = `/api/communities/${EXAMPLE_COMMUNITY_ID}/donations`
const donationIdParam = brandedPathParam('donationId', 'dntn', 'Target donation.')

const badRequest = (description: string) => validationFailed(description, DONATION_INSTANCE)

const gated = problemResponse(
  409,
  'donations-not-enabled',
  'Donations are not enabled',
  'conflict',
  {
    description: 'The donations feature flag has not reached Enabled for this community.',
    instance: DONATION_INSTANCE,
  },
)

const paymentUnavailable = problemResponse(
  502,
  'payment-provider-unavailable',
  'Payment provider unavailable',
  'dependency_failure',
  {
    description: 'The payment provider could not be reached.',
    retryable: true,
    instance: DONATION_INSTANCE,
  },
)

const donationNotFound = problemResponse(
  404,
  'donation-not-found',
  'Donation not found',
  'not_found',
  {
    description: 'No donation with that id exists in this community.',
    instance: DONATION_INSTANCE,
  },
)

export const OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'createDonation',
    method: 'post',
    path: '/api/communities/{communityId}/donations',
    summary: 'Create a donation in a community',
    description:
      'Creates a donation, gated by the donations feature flag and settled through the payment provider. Idempotent on Idempotency-Key.',
    tags: ['donations'],
    mutating: true,
    params: [communityIdParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'CreateDonationRequest',
    requestExample: { donor_id: EXAMPLE_USER_ID, amount_cents: 2500, currency: 'USD' },
    responses: [
      {
        code: 201,
        description: 'The recorded donation.',
        bodyRef: 'Donation',
        example: EXAMPLE_DONATION,
        links: {
          GetDonation: {
            operationId: 'getDonation',
            parameters: {
              communityId: '$response.body#/community_id',
              donationId: '$response.body#/id',
            },
            description: 'Fetch the donation that was just created.',
          },
        },
      },
      gated,
      paymentUnavailable,
      badRequest('The request body or headers failed validation.'),
    ],
  },
  {
    operationId: 'getDonation',
    method: 'get',
    path: '/api/communities/{communityId}/donations/{donationId}',
    summary: 'Get a single donation',
    description: 'Returns a donation by id within a community.',
    tags: ['donations'],
    mutating: false,
    params: [communityIdParam, donationIdParam],
    responses: [
      { code: 200, description: 'The donation.', bodyRef: 'Donation', example: EXAMPLE_DONATION },
      badRequest('The community id or donation id in the path is malformed.'),
      donationNotFound,
    ],
  },
  {
    operationId: 'listDonations',
    method: 'get',
    path: '/api/communities/{communityId}/donations',
    summary: 'List a community’s donations',
    description: 'Returns the most recent donations in a community, newest first.',
    tags: ['donations'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      {
        code: 200,
        description: 'A page of donations.',
        bodyRef: 'DonationList',
        example: { community_id: EXAMPLE_COMMUNITY_ID, donations: [EXAMPLE_DONATION] },
      },
      badRequest('The community id in the path is malformed.'),
    ],
  },
  ...SYSTEM_OPERATIONS,
]
