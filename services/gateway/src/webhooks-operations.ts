import {
  brandedPathParam,
  communityIdParam,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_WEBHOOK_DELIVERY,
  EXAMPLE_WEBHOOK_SUBSCRIPTION,
  EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  EXAMPLE_WEBHOOK_URL,
  idempotencyKeyHeaderParam,
  type OasOperation,
  problemResponse,
} from '@qaroom/contracts'
import { upstreamUnreachable502 } from './problem-responses'

/**
 * The webhook CRUD operations the gateway proxies to webhooks-service (Milestone 11). Split out of
 * `operations.ts` to keep that file under the 500-line cap; spread into the gateway OPERATIONS array.
 *
 * The gateway-edge 400 and the Idempotency-Key 409 are NOT hand-listed here: every `/api/*` op gets
 * the 400 stamped uniformly, and every mutating `/api/*` op gets the 409 stamped, by the
 * cross-cutting map in `operations.ts`. Only genuinely op-specific responses live below.
 */
const webhooksUnreachable502 = upstreamUnreachable502(
  'webhooks-unreachable',
  'webhooks-service',
  'webhooks-service is unreachable, timed out, or the gateway circuit breaker is open.',
)
const webhookNotFound404 = problemResponse(
  404,
  'webhook-not-found',
  'Webhook subscription not found',
  'not_found',
  { description: 'No subscription with that id exists in this community.' },
)
const webhookUrlInvalid422 = problemResponse(
  422,
  'webhook-url-invalid',
  'Webhook URL is not a public https endpoint',
  'validation',
  { description: 'The delivery URL must be https and must not target a private/loopback host.' },
)
const webhookIllegalTransition409 = problemResponse(
  409,
  'webhook-illegal-transition',
  'Illegal subscription status transition',
  'conflict',
  { description: 'The subscription cannot move to the requested status from its current status.' },
)
const subscriptionIdParam = brandedPathParam('subscriptionId', 'whsub', 'Target subscription.')
const webhookGetLink = {
  GetWebhook: {
    operationId: 'getWebhook',
    parameters: {
      communityId: '$response.body#/community_id',
      subscriptionId: '$response.body#/id',
    },
    description: 'Fetch the affected subscription.',
  },
}

export const WEBHOOK_OPERATIONS: readonly OasOperation[] = [
  {
    operationId: 'createWebhook',
    method: 'post',
    path: '/api/communities/{communityId}/webhook-subscriptions',
    summary: 'Register a webhook subscription (proxied to webhooks-service)',
    description:
      'Validates at the edge, forwards to webhooks-service. Returns the write-once signing secret. Idempotent on Idempotency-Key.',
    tags: ['webhooks'],
    mutating: true,
    params: [communityIdParam, idempotencyKeyHeaderParam],
    requestBodyRef: 'CreateWebhookRequest',
    requestExample: { url: EXAMPLE_WEBHOOK_URL, event_types: ['post.created'] },
    responses: [
      {
        code: 201,
        description: 'The created subscription, including the write-once secret.',
        bodyRef: 'WebhookSubscriptionWithSecret',
        example: { ...EXAMPLE_WEBHOOK_SUBSCRIPTION, secret: 'whsec_…' },
        links: webhookGetLink,
      },
      webhookUrlInvalid422,
      webhooksUnreachable502,
    ],
  },
  {
    operationId: 'listWebhooks',
    method: 'get',
    path: '/api/communities/{communityId}/webhook-subscriptions',
    summary: 'List a community’s webhook subscriptions (proxied)',
    description: 'Returns every webhook subscription in a community, via webhooks-service.',
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
      webhooksUnreachable502,
    ],
  },
  {
    operationId: 'getWebhook',
    method: 'get',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}',
    summary: 'Get a single webhook subscription (proxied)',
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
      webhookNotFound404,
      webhooksUnreachable502,
    ],
  },
  {
    operationId: 'deleteWebhook',
    method: 'delete',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}',
    summary: 'Delete a webhook subscription (proxied)',
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
      webhookNotFound404,
      webhooksUnreachable502,
    ],
  },
  {
    operationId: 'pauseWebhook',
    method: 'post',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}/pause',
    summary: 'Pause a webhook subscription (proxied)',
    description: 'Pauses an Active subscription. Idempotent on Idempotency-Key.',
    tags: ['webhooks'],
    mutating: true,
    params: [communityIdParam, subscriptionIdParam, idempotencyKeyHeaderParam],
    responses: [
      {
        code: 200,
        description: 'The paused subscription.',
        bodyRef: 'WebhookSubscription',
        example: { ...EXAMPLE_WEBHOOK_SUBSCRIPTION, status: 'Paused' },
        links: webhookGetLink,
      },
      webhookIllegalTransition409,
      webhookNotFound404,
      webhooksUnreachable502,
    ],
  },
  {
    operationId: 'resumeWebhook',
    method: 'post',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}/resume',
    summary: 'Resume a webhook subscription (proxied)',
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
        links: webhookGetLink,
      },
      webhookIllegalTransition409,
      webhookNotFound404,
      webhooksUnreachable502,
    ],
  },
  {
    operationId: 'listWebhookDeliveries',
    method: 'get',
    path: '/api/communities/{communityId}/webhook-subscriptions/{subscriptionId}/deliveries',
    summary: 'List a subscription’s deliveries (proxied)',
    description: 'Returns the delivery ledger for a subscription — the observable retry contract.',
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
      webhookNotFound404,
      webhooksUnreachable502,
    ],
  },
]
