import { resolve } from 'node:path'
import { MatchersV3, PactV4 } from '@pact-foundation/pact'
import {
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  EXAMPLE_WEBHOOK_URL,
} from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { createWebhooksClient } from '../../src/clients/webhooks-client'

/**
 * Consumer-driven contract (Pact) for the gateway → webhooks-service proxy path (Milestone 11).
 * Running this against the Pact mock emits `services/gateway/pacts/gateway-webhooks.json`, which
 * webhooks-service verifies as the provider (services/webhooks/tests/contracts/provider.verify.ts).
 * It also exercises the real `webhooks-client` fetch path (the bounded-timeout seam) against the mock.
 * The pact file is an OUTPUT of this test — it is no longer hand-authored.
 *
 * Coverage spans the full `WebhooksClient` operation set (createWebhook, listWebhooks, getWebhook,
 * deleteWebhook, pauseWebhook, resumeWebhook, listWebhookDeliveries — see `webhooks-client.ts`).
 *
 * The provider's verification can seed only two states: `a webhook subscription exists` (an *Active*
 * subscription, no deliveries) and `no such webhook subscription exists`. Every interaction is pinned
 * to one of those, which fixes two response codes:
 *   • resume targets Active and the seeded subscription is already Active → the illegal-transition
 *     409 path (resume requires Paused). The Active→Paused happy path is covered by `pause`.
 *   • deliveries returns an empty ledger because no deliveries are seeded; the WebhookDelivery element
 *     shape is owned by webhooks-service's own tests + the `WebhookDeliveryList` schema.
 * Adding a `Paused`-subscription or delivery-bearing state belongs in the provider's state handlers
 * (services/webhooks/tests/contracts/provider.verify.ts), not the consumer.
 */
const { like, integer, boolean, string, regex, eachLike } = MatchersV3

const COMMUNITY = EXAMPLE_COMMUNITY_ID
const EXISTING_SUB = EXAMPLE_WEBHOOK_SUBSCRIPTION_ID
const MISSING_SUB = 'whsub_01HZY0K7M3QF8VN2J5RX9TB4XX'

// Distinct keys per mutating interaction so a provider verification replaying them against one DB
// never trips idempotency-key reuse across routes.
const IDEM_CREATE = 'idem-wh-create'
const IDEM_DELETE = 'idem-wh-delete'
const IDEM_PAUSE = 'idem-wh-pause'
const IDEM_RESUME = 'idem-wh-resume'

// Hand-authored regexes: the deliberate independent second source (docs/03 §6), not derived
// from contracts.
const WHSUB_RE = '^whsub_[0-9A-HJKMNP-TV-Z]{26}$'
const COMM_RE = '^comm_[0-9A-HJKMNP-TV-Z]{26}$'
const STATUS_RE = '^(Active|Paused|Disabled)$'
const SECRET_RE = '^whsec_[0-9a-f]{64}$'
const ISO_RE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'

// The read shape (no secret) — shared by get, list, and the pause result.
const subscriptionBody = {
  id: regex(WHSUB_RE, EXISTING_SUB),
  community_id: regex(COMM_RE, COMMUNITY),
  url: string(EXAMPLE_WEBHOOK_URL),
  event_types: eachLike('post.created'),
  status: regex(STATUS_RE, 'Active'),
  created_at: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
  updated_at: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
}

// The create-only shape: the read shape plus the write-once signing secret.
const subscriptionWithSecretBody = {
  ...subscriptionBody,
  secret: regex(SECRET_RE, `whsec_${'0'.repeat(64)}`),
}

const pausedSubscriptionBody = { ...subscriptionBody, status: regex(STATUS_RE, 'Paused') }

const PROBLEM_CT = {
  'content-type': regex('application/problem\\+json.*', 'application/problem+json'),
}

function problemBody(type: string, title: string, status: number, failureDomain: string) {
  return like({
    type: string(type),
    title: string(title),
    status: integer(status),
    retryable: boolean(false),
    // next_actions is required by the webhooks ProblemDetails schema (array of NextAction); the
    // gateway forwards the provider's body verbatim. Empty array matches the OAS examples and
    // satisfies the Pact-OAS cross-check's required-property assertion.
    next_actions: like([]),
    failure_domain: string(failureDomain),
  })
}

// Provider-state params for the seeded-subscription handler (`a webhook subscription exists`).
const SEEDED = { community_id: COMMUNITY, subscription_id: EXISTING_SUB, url: EXAMPLE_WEBHOOK_URL }

const pact = new PactV4({
  consumer: 'gateway',
  provider: 'webhooks',
  dir: resolve(import.meta.dirname, '../../pacts'),
  logLevel: 'warn',
})

describe('gateway → webhooks consumer contract', () => {
  it('creates a webhook subscription', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a request to create a webhook subscription')
      .withRequest('POST', `/api/communities/${COMMUNITY}/webhook-subscriptions`, (b) =>
        b
          .headers({ 'content-type': 'application/json', 'Idempotency-Key': like(IDEM_CREATE) })
          .jsonBody({ url: EXAMPLE_WEBHOOK_URL, event_types: ['post.created'] }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like(subscriptionWithSecretBody)))
      .executeTest(async (mock) => {
        const res = await createWebhooksClient(mock.url).createWebhook(
          COMMUNITY,
          { url: EXAMPLE_WEBHOOK_URL, event_types: ['post.created'] },
          IDEM_CREATE,
        )
        expect(res.status).toBe(201)
      })
  })

  it('lists a community’s webhook subscriptions', async () => {
    await pact
      .addInteraction()
      .given('a webhook subscription exists', SEEDED)
      .uponReceiving('a request to list webhook subscriptions')
      .withRequest('GET', `/api/communities/${COMMUNITY}/webhook-subscriptions`)
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({ community_id: regex(COMM_RE, COMMUNITY), webhooks: eachLike(subscriptionBody) }),
        ),
      )
      .executeTest(async (mock) => {
        const res = await createWebhooksClient(mock.url).listWebhooks(COMMUNITY)
        expect(res.status).toBe(200)
      })
  })

  it('fetches an existing webhook subscription', async () => {
    await pact
      .addInteraction()
      .given('a webhook subscription exists', SEEDED)
      .uponReceiving('a request to get an existing webhook subscription')
      .withRequest('GET', `/api/communities/${COMMUNITY}/webhook-subscriptions/${EXISTING_SUB}`)
      .willRespondWith(200, (b) => b.jsonBody(like(subscriptionBody)))
      .executeTest(async (mock) => {
        const res = await createWebhooksClient(mock.url).getWebhook(COMMUNITY, EXISTING_SUB)
        expect(res.status).toBe(200)
      })
  })

  it('receives a 404 problem for a missing webhook subscription', async () => {
    await pact
      .addInteraction()
      .given('no such webhook subscription exists', {
        community_id: COMMUNITY,
        subscription_id: MISSING_SUB,
      })
      .uponReceiving('a request to get a missing webhook subscription')
      .withRequest('GET', `/api/communities/${COMMUNITY}/webhook-subscriptions/${MISSING_SUB}`)
      .willRespondWith(404, (b) =>
        b
          .headers(PROBLEM_CT)
          .jsonBody(
            problemBody(
              'https://qaroom.dev/errors/webhook-not-found',
              'Webhook subscription not found',
              404,
              'not_found',
            ),
          ),
      )
      .executeTest(async (mock) => {
        const res = await createWebhooksClient(mock.url).getWebhook(COMMUNITY, MISSING_SUB)
        expect(res.status).toBe(404)
      })
  })

  it('deletes a webhook subscription', async () => {
    await pact
      .addInteraction()
      .given('a webhook subscription exists', SEEDED)
      .uponReceiving('a request to delete a webhook subscription')
      .withRequest(
        'DELETE',
        `/api/communities/${COMMUNITY}/webhook-subscriptions/${EXISTING_SUB}`,
        (b) => b.headers({ 'Idempotency-Key': like(IDEM_DELETE) }),
      )
      .willRespondWith(204)
      .executeTest(async (mock) => {
        const res = await createWebhooksClient(mock.url).deleteWebhook(
          COMMUNITY,
          EXISTING_SUB,
          IDEM_DELETE,
        )
        expect(res.status).toBe(204)
      })
  })

  it('pauses an active webhook subscription', async () => {
    await pact
      .addInteraction()
      .given('a webhook subscription exists', SEEDED)
      .uponReceiving('a request to pause an active webhook subscription')
      .withRequest(
        'POST',
        `/api/communities/${COMMUNITY}/webhook-subscriptions/${EXISTING_SUB}/pause`,
        // No body: pause is a pure state toggle. The client sends none, so neither Content-Type nor
        // a JSON body appears here (an empty `{}` body tripped a pact-core verify serialization bug).
        (b) => b.headers({ 'Idempotency-Key': like(IDEM_PAUSE) }),
      )
      .willRespondWith(200, (b) => b.jsonBody(like(pausedSubscriptionBody)))
      .executeTest(async (mock) => {
        const res = await createWebhooksClient(mock.url).pauseWebhook(
          COMMUNITY,
          EXISTING_SUB,
          IDEM_PAUSE,
        )
        expect(res.status).toBe(200)
      })
  })

  it('rejects resuming an already-active subscription with a 409', async () => {
    await pact
      .addInteraction()
      .given('a webhook subscription exists', SEEDED)
      .uponReceiving('a request to resume an active webhook subscription')
      .withRequest(
        'POST',
        `/api/communities/${COMMUNITY}/webhook-subscriptions/${EXISTING_SUB}/resume`,
        // No body: resume is a pure state toggle (see the pause interaction above).
        (b) => b.headers({ 'Idempotency-Key': like(IDEM_RESUME) }),
      )
      .willRespondWith(409, (b) =>
        b
          .headers(PROBLEM_CT)
          .jsonBody(
            problemBody(
              'https://qaroom.dev/errors/webhook-illegal-transition',
              'Illegal subscription status transition',
              409,
              'conflict',
            ),
          ),
      )
      .executeTest(async (mock) => {
        const res = await createWebhooksClient(mock.url).resumeWebhook(
          COMMUNITY,
          EXISTING_SUB,
          IDEM_RESUME,
        )
        expect(res.status).toBe(409)
      })
  })

  it('lists a subscription’s deliveries (empty ledger)', async () => {
    await pact
      .addInteraction()
      .given('a webhook subscription exists', SEEDED)
      .uponReceiving('a request to list a subscription’s deliveries')
      .withRequest(
        'GET',
        `/api/communities/${COMMUNITY}/webhook-subscriptions/${EXISTING_SUB}/deliveries`,
      )
      .willRespondWith(200, (b) =>
        b.jsonBody(like({ subscription_id: regex(WHSUB_RE, EXISTING_SUB), deliveries: like([]) })),
      )
      .executeTest(async (mock) => {
        const res = await createWebhooksClient(mock.url).listWebhookDeliveries(
          COMMUNITY,
          EXISTING_SUB,
        )
        expect(res.status).toBe(200)
      })
  })
})
