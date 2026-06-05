import {
  CommunityId,
  isPublicHttpsUrl,
  WebhookDelivery,
  WebhookDeliveryList,
  WebhookEventType,
  WebhookSubscription,
  WebhookSubscriptionId,
  WebhookSubscriptionList,
  WebhookSubscriptionWithSecret,
} from '@qaroom/contracts'
import { problem, withIdempotency } from '@qaroom/service-kit'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { RouteDeps } from './deps'
import {
  createSubscription,
  deleteSubscription,
  getSubscription,
  listDeliveries,
  listSubscriptions,
  setSubscriptionStatus,
} from './repository'

const BASE = '/api/communities/:communityId/webhook-subscriptions'
const CREATE_ROUTE = 'POST /api/communities/{communityId}/webhook-subscriptions'
const DELETE_ROUTE = 'DELETE /api/communities/{communityId}/webhook-subscriptions/{subscriptionId}'
const PAUSE_ROUTE =
  'POST /api/communities/{communityId}/webhook-subscriptions/{subscriptionId}/pause'
const RESUME_ROUTE =
  'POST /api/communities/{communityId}/webhook-subscriptions/{subscriptionId}/resume'

/**
 * Structural body schema (no SSRF refine) so a bad URL surfaces as a dedicated 422
 * `webhook-url-invalid`, not a generic 400 — the SSRF guard is checked explicitly below.
 */
const CreateBody = z.strictObject({
  url: z.string().url(),
  event_types: z.array(WebhookEventType).min(1),
})

function notFound(communityId: string, subscriptionId: string) {
  return problem({
    slug: 'webhook-not-found',
    title: 'Webhook subscription not found',
    status: 404,
    failure_domain: 'not_found',
    detail: `No subscription with id ${subscriptionId} in community ${communityId}.`,
  })
}

export function registerWebhookRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // Register a subscription. The signing secret is returned ONCE here (write-once).
  app.post<{ Params: { communityId: string } }>(BASE, async (req, reply) => {
    const communityId = CommunityId.parse(req.params.communityId)
    const body = CreateBody.parse(req.body)
    if (!isPublicHttpsUrl(body.url)) {
      throw problem({
        slug: 'webhook-url-invalid',
        title: 'Webhook URL is not a public https endpoint',
        status: 422,
        failure_domain: 'validation',
        detail:
          'The delivery URL must be https and must not target a loopback/private/link-local host.',
      })
    }
    await withIdempotency(
      req,
      reply,
      { db: deps.db, clock: deps.clock, route: CREATE_ROUTE, status: 201 },
      async () => {
        const created = await createSubscription(deps.db, deps, {
          communityId,
          url: body.url,
          eventTypes: body.event_types,
        })
        return WebhookSubscriptionWithSecret.parse(created)
      },
    )
  })

  // List a community's subscriptions.
  app.get<{ Params: { communityId: string } }>(BASE, async (req, reply) => {
    const communityId = CommunityId.parse(req.params.communityId)
    const webhooks = await listSubscriptions(deps.db, communityId)
    reply.code(200).send(WebhookSubscriptionList.parse({ community_id: communityId, webhooks }))
  })

  // Fetch a single subscription (tenant-scoped: another community's id 404s).
  app.get<{ Params: { communityId: string; subscriptionId: string } }>(
    `${BASE}/:subscriptionId`,
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const subscriptionId = WebhookSubscriptionId.parse(req.params.subscriptionId)
      const record = await getSubscription(deps.db, subscriptionId)
      if (!record || record.community_id !== communityId)
        throw notFound(communityId, subscriptionId)
      reply.code(200).send(WebhookSubscription.parse(record))
    },
  )

  // Delete a subscription. Idempotent on Idempotency-Key (convention): the first call deletes and
  // returns 204; a replay with the same key returns the cached 204 (not a 404 from the now-absent
  // row). produce returns an empty object so the replay store persists valid jsonb (204 carries no body).
  app.delete<{ Params: { communityId: string; subscriptionId: string } }>(
    `${BASE}/:subscriptionId`,
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const subscriptionId = WebhookSubscriptionId.parse(req.params.subscriptionId)
      await withIdempotency(
        req,
        reply,
        { db: deps.db, clock: deps.clock, route: DELETE_ROUTE, status: 204 },
        async () => {
          const deleted = await deleteSubscription(deps.db, communityId, subscriptionId)
          if (!deleted) throw notFound(communityId, subscriptionId)
          return {}
        },
      )
    },
  )

  // Pause / resume (Active↔Paused state toggle; illegal transition → 409).
  const statusRoute = (action: 'pause' | 'resume', route: string, target: 'Active' | 'Paused') =>
    app.post<{ Params: { communityId: string; subscriptionId: string } }>(
      `${BASE}/:subscriptionId/${action}`,
      async (req, reply) => {
        const communityId = CommunityId.parse(req.params.communityId)
        const subscriptionId = WebhookSubscriptionId.parse(req.params.subscriptionId)
        await withIdempotency(
          req,
          reply,
          { db: deps.db, clock: deps.clock, route, status: 200 },
          async () => {
            const result = await setSubscriptionStatus(
              deps.db,
              deps,
              communityId,
              subscriptionId,
              target,
            )
            if (!result.ok && result.reason === 'not_found')
              throw notFound(communityId, subscriptionId)
            if (!result.ok) {
              throw problem({
                slug: 'webhook-illegal-transition',
                title: 'Illegal subscription status transition',
                status: 409,
                failure_domain: 'conflict',
                detail: `Cannot ${action} subscription ${subscriptionId} from its current status.`,
              })
            }
            return WebhookSubscription.parse(result.subscription)
          },
        )
      },
    )
  statusRoute('pause', PAUSE_ROUTE, 'Paused')
  statusRoute('resume', RESUME_ROUTE, 'Active')

  // List a subscription's deliveries (the observable retry contract).
  app.get<{ Params: { communityId: string; subscriptionId: string } }>(
    `${BASE}/:subscriptionId/deliveries`,
    async (req, reply) => {
      const communityId = CommunityId.parse(req.params.communityId)
      const subscriptionId = WebhookSubscriptionId.parse(req.params.subscriptionId)
      const subscription = await getSubscription(deps.db, subscriptionId)
      if (!subscription || subscription.community_id !== communityId) {
        throw notFound(communityId, subscriptionId)
      }
      const deliveries = (await listDeliveries(deps.db, subscriptionId)).map((d) =>
        WebhookDelivery.parse(d),
      )
      reply
        .code(200)
        .send(WebhookDeliveryList.parse({ subscription_id: subscriptionId, deliveries }))
    },
  )
}
