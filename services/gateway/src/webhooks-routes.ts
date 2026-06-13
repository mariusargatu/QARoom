import { CommunityId, CreateWebhookRequest, WebhookSubscriptionId } from '@qaroom/contracts'
import { idempotencyKeyFrom } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import type { GatewayRouteDeps } from './deps'
import { forward, type Upstream } from './forward'
import type { WebhooksClient } from './webhooks-client'

const WEBHOOKS: Upstream = {
  slug: 'webhooks-unreachable',
  title: 'Upstream webhooks-service unavailable',
  detail: 'webhooks-service did not respond (timed out or refused).',
}

const BASE = '/api/communities/:communityId/webhook-subscriptions'

/** Proxy the webhooks CRUD surface, validated at the edge and forwarded through the bounded-timeout client. */
export function registerWebhooksRoutes(
  app: FastifyInstance,
  deps: GatewayRouteDeps,
  webhooks: WebhooksClient,
): void {
  app.post<{ Params: { communityId: string } }>(BASE, async (req, reply) => {
    const communityId = CommunityId.parse(req.params.communityId)
    const key = idempotencyKeyFrom(req)
    const body = CreateWebhookRequest.parse(req.body)
    await forward(reply, deps, true, WEBHOOKS, () => webhooks.createWebhook(communityId, body, key))
  })

  app.get<{ Params: { communityId: string } }>(BASE, async (req, reply) => {
    const communityId = CommunityId.parse(req.params.communityId)
    await forward(reply, deps, false, WEBHOOKS, () => webhooks.listWebhooks(communityId))
  })

  app.get<{ Params: { communityId: string; subscriptionId: string } }>(
    `${BASE}/:subscriptionId`,
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const subscriptionId = WebhookSubscriptionId.parse(req.params.subscriptionId)
      await forward(reply, deps, false, WEBHOOKS, () =>
        webhooks.getWebhook(communityId, subscriptionId),
      )
    },
  )

  app.delete<{ Params: { communityId: string; subscriptionId: string } }>(
    `${BASE}/:subscriptionId`,
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const subscriptionId = WebhookSubscriptionId.parse(req.params.subscriptionId)
      const key = idempotencyKeyFrom(req)
      await forward(reply, deps, true, WEBHOOKS, () =>
        webhooks.deleteWebhook(communityId, subscriptionId, key),
      )
    },
  )

  for (const action of ['pause', 'resume'] as const) {
    app.post<{ Params: { communityId: string; subscriptionId: string } }>(
      `${BASE}/:subscriptionId/${action}`,
      async (req, reply) => {
        const communityId = CommunityId.parse(req.params.communityId)
        const subscriptionId = WebhookSubscriptionId.parse(req.params.subscriptionId)
        const key = idempotencyKeyFrom(req)
        await forward(reply, deps, true, WEBHOOKS, () =>
          action === 'pause'
            ? webhooks.pauseWebhook(communityId, subscriptionId, key)
            : webhooks.resumeWebhook(communityId, subscriptionId, key),
        )
      },
    )
  }

  app.get<{ Params: { communityId: string; subscriptionId: string } }>(
    `${BASE}/:subscriptionId/deliveries`,
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const subscriptionId = WebhookSubscriptionId.parse(req.params.subscriptionId)
      await forward(reply, deps, false, WEBHOOKS, () =>
        webhooks.listWebhookDeliveries(communityId, subscriptionId),
      )
    },
  )
}
