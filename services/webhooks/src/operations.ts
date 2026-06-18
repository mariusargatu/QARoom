import {
  brandedPathParam,
  communityIdParam,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_WEBHOOK_DELIVERY,
  EXAMPLE_WEBHOOK_SUBSCRIPTION,
  EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  EXAMPLE_WEBHOOK_URL,
  idempotencyConflict,
  idempotencyKeyHeaderParam,
  type OasOperation,
  problemResponse,
  SYSTEM_OPERATIONS,
  validationFailed,
} from '@qaroom/contracts'

/**
 * The canonical operation registry for webhooks-service. Single source for the committed
 * `openapi.yaml`, the `/system/capabilities` response, and the cross-service MCP manifest.
 */
const WEBHOOK_INSTANCE = `/api/communities/${EXAMPLE_COMMUNITY_ID}/webhook-subscriptions`
const subscriptionIdParam = brandedPathParam('subscriptionId', 'whsub', 'Target subscription.')

const WITH_SECRET_EXAMPLE = { ...EXAMPLE_WEBHOOK_SUBSCRIPTION, secret: 'whsec_…' }

const badRequest = (description: string) => validationFailed(description, WEBHOOK_INSTANCE)

const urlInvalid = problemResponse(
  422,
  'webhook-url-invalid',
  'Webhook URL is not a public https endpoint',
  'validation',
  {
    description:
      'The delivery URL must be https and must not target a loopback/private/link-local host (SSRF guard).',
    instance: WEBHOOK_INSTANCE,
  },
)

const notFound = problemResponse(
  404,
  'webhook-not-found',
  'Webhook subscription not found',
  'not_found',
  {
    description: 'No subscription with that id exists in this community.',
    instance: WEBHOOK_INSTANCE,
  },
)

const illegalTransition = problemResponse(
  409,
  'webhook-illegal-transition',
  'Illegal subscription status transition',
  'conflict',
  {
    description: 'The subscription cannot move to the requested status from its current status.',
    instance: WEBHOOK_INSTANCE,
  },
)

const getLink = {
  GetWebhook: {
    operationId: 'getWebhook',
    parameters: {
      communityId: '$response.body#/community_id',
      subscriptionId: '$response.body#/id',
    },
    description: 'Fetch the affected subscription.',
  },
}

export const OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'createWebhook',
    method: 'post',
    path: '/api/communities/{communityId}/webhook-subscriptions',
    summary: 'Register a webhook subscription',
    description:
      'Registers an external https endpoint to receive a community’s events. Returns the write-once signing secret. Idempotent on Idempotency-Key.',
    tags: ['webhooks'],
    mutating: true,
    params: [communityIdParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'CreateWebhookRequest',
    requestExample: {
      url: EXAMPLE_WEBHOOK_URL,
      event_types: ['post.created', 'donation.state.changed'],
    },
    responses: [
      {
        code: 201,
        description: 'The created subscription, including the write-once secret.',
        bodyRef: 'WebhookSubscriptionWithSecret',
        example: WITH_SECRET_EXAMPLE,
        links: getLink,
      },
      urlInvalid,
      idempotencyConflict(WEBHOOK_INSTANCE),
      badRequest('The request body or headers failed validation.'),
    ],
  },
  {
    operationId: 'listWebhooks',
    method: 'get',
    path: '/api/communities/{communityId}/webhook-subscriptions',
    summary: 'List a community’s webhook subscriptions',
    description: 'Returns every webhook subscription registered in a community.',
    tags: ['webhooks'],
    mutating: false,
    params: [communityIdParam],
    responses: [
      {
        code: 200,
        description: 'The community’s subscriptions.',
        bodyRef: 'WebhookSubscriptionList',
        example: { community_id: EXAMPLE_COMMUNITY_ID, webhooks: [EXAMPLE_WEBHOOK_SUBSCRIPTION] },
      },
      badRequest('The community id in the path is malformed.'),
    ],
  },
  {
    operationId: 'getWebhook',
    method: 'get',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}',
    summary: 'Get a single webhook subscription',
    description: 'Returns a subscription by id within a community (the secret is never returned).',
    tags: ['webhooks'],
    mutating: false,
    params: [communityIdParam, subscriptionIdParam],
    responses: [
      {
        code: 200,
        description: 'The subscription.',
        bodyRef: 'WebhookSubscription',
        example: EXAMPLE_WEBHOOK_SUBSCRIPTION,
      },
      badRequest('The community id or subscription id in the path is malformed.'),
      notFound,
    ],
  },
  {
    operationId: 'deleteWebhook',
    method: 'delete',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}',
    summary: 'Delete a webhook subscription',
    description: 'Removes a subscription. Idempotent on Idempotency-Key.',
    tags: ['webhooks'],
    mutating: true,
    params: [communityIdParam, subscriptionIdParam, idempotencyKeyHeaderParam],
    responses: [
      {
        code: 204,
        description: 'The subscription was deleted.',
        links: {
          ListWebhooks: {
            operationId: 'listWebhooks',
            parameters: { communityId: '$request.path.communityId' },
            description: 'List the remaining subscriptions.',
          },
        },
      },
      // Undocumented-400 fuzz finding (gauntlet phase 6, live webhooks): mutating subscription
      // ops reject a missing/invalid Idempotency-Key or malformed params as a validation 400,
      // which the spec never declared.
      badRequest('The request params or Idempotency-Key header failed validation.'),
      notFound,
    ],
  },
  {
    operationId: 'pauseWebhook',
    method: 'post',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}/pause',
    summary: 'Pause a webhook subscription',
    description:
      'Pauses an Active subscription so no new deliveries are enqueued. Idempotent on Idempotency-Key.',
    tags: ['webhooks'],
    mutating: true,
    params: [communityIdParam, subscriptionIdParam, idempotencyKeyHeaderParam],
    responses: [
      {
        code: 200,
        description: 'The paused subscription.',
        bodyRef: 'WebhookSubscription',
        example: { ...EXAMPLE_WEBHOOK_SUBSCRIPTION, status: 'Paused' },
        links: getLink,
      },
      badRequest('The request params or Idempotency-Key header failed validation.'),
      illegalTransition,
      notFound,
    ],
  },
  {
    operationId: 'resumeWebhook',
    method: 'post',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}/resume',
    summary: 'Resume a webhook subscription',
    description: 'Resumes a Paused subscription. Idempotent on Idempotency-Key.',
    tags: ['webhooks'],
    mutating: true,
    params: [communityIdParam, subscriptionIdParam, idempotencyKeyHeaderParam],
    responses: [
      {
        code: 200,
        description: 'The resumed subscription.',
        bodyRef: 'WebhookSubscription',
        example: EXAMPLE_WEBHOOK_SUBSCRIPTION,
        links: getLink,
      },
      badRequest('The request params or Idempotency-Key header failed validation.'),
      illegalTransition,
      notFound,
    ],
  },
  {
    operationId: 'listWebhookDeliveries',
    method: 'get',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}/deliveries',
    summary: 'List a subscription’s deliveries',
    description:
      'Returns the delivery ledger for a subscription, newest first — the observable retry contract (attempt, next_attempt_at, status).',
    tags: ['webhooks'],
    mutating: false,
    params: [communityIdParam, subscriptionIdParam],
    responses: [
      {
        code: 200,
        description: 'A page of deliveries.',
        bodyRef: 'WebhookDeliveryList',
        example: {
          subscription_id: EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
          deliveries: [EXAMPLE_WEBHOOK_DELIVERY],
        },
      },
      badRequest('The community id or subscription id in the path is malformed.'),
      notFound,
    ],
  },
  ...SYSTEM_OPERATIONS,
]
