import {
  EXAMPLE_WEBHOOK_DELIVERY,
  EXAMPLE_WEBHOOK_SUBSCRIPTION,
  EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  EXAMPLE_WEBHOOK_URL,
} from '@qaroom/contracts'
import type { NormalizedResponse } from '@qaroom/testing-utils/harness'
import {
  expectLamportAdvanced,
  expectProblemContentType,
  expectRFC7807,
  lamportOf,
} from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import {
  constantContent,
  constantWebhooks,
  recordingWebhooks,
  SAMPLE,
  setupGatewayTest,
  unreachableWebhooks,
} from './harness'

const dummyContent = constantContent({ status: 200, body: {}, contentType: 'application/json' })
const json = (status: number, body: unknown) =>
  ({ status, body, contentType: 'application/json' }) as const

const SUB = EXAMPLE_WEBHOOK_SUBSCRIPTION_ID
const BASE = `/api/communities/${SAMPLE.community}/webhook-subscriptions`
const createBody = { url: EXAMPLE_WEBHOOK_URL, event_types: ['post.created'] }
const key = { 'idempotency-key': 'wh-1' }

/** DELETE is not on the shared inject client (get/post only), so call app.inject directly. */
const del = async (
  app: {
    inject: (
      o: unknown,
    ) => Promise<{ statusCode: number; headers: Record<string, unknown>; body: string }>
  },
  url: string,
  headers: Record<string, string>,
): Promise<NormalizedResponse> => {
  const r = await app.inject({ method: 'DELETE', url, headers })
  return {
    status: r.statusCode,
    contentType: r.headers['content-type'] as string | undefined,
    headers: r.headers,
    json: r.body ? JSON.parse(r.body) : undefined,
  }
}

describe('gateway → webhooks proxy (reads)', () => {
  it('proxies the list of a community’s subscriptions through unchanged', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks(
        json(200, { community_id: SAMPLE.community, webhooks: [EXAMPLE_WEBHOOK_SUBSCRIPTION] }),
      ),
    })
    const res = await request.get(BASE)
    expect(res.status).toBe(200)
    expect((res.json as { webhooks: unknown[] }).webhooks).toHaveLength(1)
  })

  it('proxies a single subscription read through unchanged', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks(json(200, EXAMPLE_WEBHOOK_SUBSCRIPTION)),
    })
    const res = await request.get(`${BASE}/${SUB}`)
    expect(res.status).toBe(200)
    expect(res.json).toEqual(EXAMPLE_WEBHOOK_SUBSCRIPTION)
  })

  it('proxies the delivery ledger read through unchanged', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks(
        json(200, { subscription_id: SUB, deliveries: [EXAMPLE_WEBHOOK_DELIVERY] }),
      ),
    })
    const res = await request.get(`${BASE}/${SUB}/deliveries`)
    expect(res.status).toBe(200)
    expect((res.json as { deliveries: unknown[] }).deliveries).toHaveLength(1)
  })

  it('rejects a malformed community id at the edge with a 400 and never calls the upstream', async () => {
    const { request } = setupGatewayTest(dummyContent, { webhooks: unreachableWebhooks() })
    const res = await request.get('/api/communities/not-a-community/webhook-subscriptions')
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('rejects a malformed subscription id on a single read with a 400', async () => {
    const { request } = setupGatewayTest(dummyContent, { webhooks: unreachableWebhooks() })
    const res = await request.get(`${BASE}/not-a-subscription`)
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('surfaces an unreachable webhooks upstream as a retryable 502 dependency_failure', async () => {
    const { request } = setupGatewayTest(dummyContent, { webhooks: unreachableWebhooks() })
    const res = await request.get(BASE)
    expectProblemContentType(res.contentType)
    const problem = expectRFC7807(res.json, { status: 502, failureDomain: 'dependency_failure' })
    expect(problem.type).toBe('https://qaroom.dev/errors/webhooks-unreachable')
    expect(problem.retryable).toBe(true)
  })

  it('passes a 204-shaped upstream reply (no content-type) through without inventing one', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks({ status: 200, body: undefined, contentType: null }),
    })
    const res = await request.get(BASE)
    expect(res.status).toBe(200)
    expect(res.json).toBeUndefined()
  })
})

describe('gateway → webhooks proxy (mutations)', () => {
  it('proxies the upstream 201 and body through unchanged on create', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks(json(201, EXAMPLE_WEBHOOK_SUBSCRIPTION)),
    })
    const res = await request.post(BASE, createBody, key)
    expect(res.status).toBe(201)
    expect(res.json).toEqual(EXAMPLE_WEBHOOK_SUBSCRIPTION)
  })

  it('advances the gateway lamport on a successful create', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks(json(201, EXAMPLE_WEBHOOK_SUBSCRIPTION)),
    })
    const before = lamportOf((await request.get('/system/state')).json)
    await request.post(BASE, createBody, { 'idempotency-key': 'wh-bump' })
    const after = lamportOf((await request.get('/system/state')).json)
    expectLamportAdvanced(before, after)
  })

  it('rejects a create without an Idempotency-Key with a 400', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks(json(201, EXAMPLE_WEBHOOK_SUBSCRIPTION)),
    })
    const res = await request.post(BASE, createBody)
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('rejects a create with a body that fails the request schema with a 400', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks(json(201, EXAMPLE_WEBHOOK_SUBSCRIPTION)),
    })
    const res = await request.post(BASE, { url: 'http://10.0.0.1/internal', event_types: [] }, key)
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('proxies a pause and advances the gateway lamport', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks(json(200, { ...EXAMPLE_WEBHOOK_SUBSCRIPTION, status: 'Paused' })),
    })
    const before = lamportOf((await request.get('/system/state')).json)
    const res = await request.post(`${BASE}/${SUB}/pause`, {}, { 'idempotency-key': 'wh-pause' })
    expect(res.status).toBe(200)
    const after = lamportOf((await request.get('/system/state')).json)
    expectLamportAdvanced(before, after)
  })

  it('proxies a resume through unchanged', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks(json(200, { ...EXAMPLE_WEBHOOK_SUBSCRIPTION, status: 'Active' })),
    })
    const res = await request.post(`${BASE}/${SUB}/resume`, {}, { 'idempotency-key': 'wh-resume' })
    expect(res.status).toBe(200)
    expect((res.json as { status: string }).status).toBe('Active')
  })

  it('proxies a delete (204) and advances the gateway lamport', async () => {
    const ctx = setupGatewayTest(dummyContent, {
      webhooks: constantWebhooks({ status: 204, body: undefined, contentType: null }),
    })
    const before = lamportOf((await ctx.request.get('/system/state')).json)
    const res = await del(ctx.app, `${BASE}/${SUB}`, { 'idempotency-key': 'wh-del' })
    expect(res.status).toBe(204)
    const after = lamportOf((await ctx.request.get('/system/state')).json)
    expectLamportAdvanced(before, after)
  })

  it('rejects a delete with a malformed subscription id with a 400', async () => {
    const ctx = setupGatewayTest(dummyContent, { webhooks: unreachableWebhooks() })
    const res = await del(ctx.app, `${BASE}/not-a-subscription`, { 'idempotency-key': 'wh-del' })
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })
})

/**
 * Route → upstream-method wiring: pause and resume share a signature, so a route bound to the
 * wrong sibling would pass a constant-reply test. The recording stub tags each reply with its
 * method name, so asserting the tag per route catches the miswire.
 */
describe('gateway → webhooks route/method wiring', () => {
  const calledMethodOf = (j: unknown): string => (j as { calledMethod: string }).calledMethod

  it('binds the pause route to pauseWebhook, not resumeWebhook', async () => {
    const { request } = setupGatewayTest(dummyContent, { webhooks: recordingWebhooks() })
    const res = await request.post(`${BASE}/${SUB}/pause`, {}, { 'idempotency-key': 'w-p' })
    expect(calledMethodOf(res.json)).toBe('pauseWebhook')
  })

  it('binds the resume route to resumeWebhook, not pauseWebhook', async () => {
    const { request } = setupGatewayTest(dummyContent, { webhooks: recordingWebhooks() })
    const res = await request.post(`${BASE}/${SUB}/resume`, {}, { 'idempotency-key': 'w-r' })
    expect(calledMethodOf(res.json)).toBe('resumeWebhook')
  })

  it('binds the list route to listWebhooks', async () => {
    const { request } = setupGatewayTest(dummyContent, { webhooks: recordingWebhooks() })
    const res = await request.get(BASE)
    expect(calledMethodOf(res.json)).toBe('listWebhooks')
  })

  it('binds the single-read route to getWebhook', async () => {
    const { request } = setupGatewayTest(dummyContent, { webhooks: recordingWebhooks() })
    const res = await request.get(`${BASE}/${SUB}`)
    expect(calledMethodOf(res.json)).toBe('getWebhook')
  })

  it('binds the deliveries route to listWebhookDeliveries', async () => {
    const { request } = setupGatewayTest(dummyContent, { webhooks: recordingWebhooks() })
    const res = await request.get(`${BASE}/${SUB}/deliveries`)
    expect(calledMethodOf(res.json)).toBe('listWebhookDeliveries')
  })

  it('binds the create route to createWebhook', async () => {
    const { request } = setupGatewayTest(dummyContent, { webhooks: recordingWebhooks() })
    const res = await request.post(BASE, createBody, key)
    expect(calledMethodOf(res.json)).toBe('createWebhook')
  })
})
