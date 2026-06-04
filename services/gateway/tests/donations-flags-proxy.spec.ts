import { EXAMPLE_DONATION, EXAMPLE_FLAG_RESOLUTION, EXAMPLE_USER_ID } from '@qaroom/contracts'
import {
  expectLamportAdvanced,
  expectProblemContentType,
  expectRFC7807,
  lamportOf,
} from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import {
  constantContent,
  constantDonations,
  constantFlags,
  SAMPLE,
  setupGatewayTest,
  unreachableDonations,
  unreachableFlags,
} from './harness'

const dummyContent = constantContent({ status: 200, body: {}, contentType: 'application/json' })
const json = (status: number, body: unknown) =>
  ({ status, body, contentType: 'application/json' }) as const

const donationBody = { donor_id: EXAMPLE_USER_ID, amount_cents: 2500, currency: 'USD' }

describe('gateway → donations proxy', () => {
  it('proxies the upstream 201 and body through unchanged on create', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      donations: constantDonations(json(201, EXAMPLE_DONATION)),
    })
    const res = await request.post(`/api/communities/${SAMPLE.community}/donations`, donationBody, {
      'idempotency-key': 'd1',
    })
    expect(res.status).toBe(201)
    expect(res.json).toEqual(EXAMPLE_DONATION)
  })

  it('advances the gateway lamport on a successful proxied donation', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      donations: constantDonations(json(201, EXAMPLE_DONATION)),
    })
    const before = lamportOf((await request.get('/system/state')).json)
    await request.post(`/api/communities/${SAMPLE.community}/donations`, donationBody, {
      'idempotency-key': 'd2',
    })
    const after = lamportOf((await request.get('/system/state')).json)
    expectLamportAdvanced(before, after)
  })

  it('rejects a malformed community id at the edge with a 400 and never calls the upstream', async () => {
    const { request } = setupGatewayTest(dummyContent, { donations: unreachableDonations() })
    const res = await request.get('/api/communities/not-a-community/donations')
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('surfaces an unreachable donations upstream as a retryable 502 dependency_failure', async () => {
    const { request } = setupGatewayTest(dummyContent, { donations: unreachableDonations() })
    const res = await request.get(`/api/communities/${SAMPLE.community}/donations`)
    expectProblemContentType(res.contentType)
    const problem = expectRFC7807(res.json, { status: 502, failureDomain: 'dependency_failure' })
    expect(problem.type).toBe('https://qaroom.dev/errors/donations-unreachable')
    expect(problem.retryable).toBe(true)
  })
})

describe('gateway → flags proxy', () => {
  it('proxies a flag resolution through unchanged', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      flags: constantFlags(json(200, EXAMPLE_FLAG_RESOLUTION)),
    })
    const res = await request.get(`/api/communities/${SAMPLE.community}/flags/donations`)
    expect(res.status).toBe(200)
    expect(res.json).toEqual(EXAMPLE_FLAG_RESOLUTION)
  })

  it('proxies a rollout advance and advances the gateway lamport', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      flags: constantFlags(json(200, EXAMPLE_FLAG_RESOLUTION)),
    })
    const before = lamportOf((await request.get('/system/state')).json)
    const res = await request.post(
      `/api/communities/${SAMPLE.community}/flags/donations/rollout`,
      { event: 'EnableRequested' },
      { 'idempotency-key': 'f1' },
    )
    expect(res.status).toBe(200)
    const after = lamportOf((await request.get('/system/state')).json)
    expectLamportAdvanced(before, after)
  })

  it('rejects a rollout advance that omits the Idempotency-Key with a 400', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      flags: constantFlags(json(200, EXAMPLE_FLAG_RESOLUTION)),
    })
    const res = await request.post(`/api/communities/${SAMPLE.community}/flags/donations/rollout`, {
      event: 'EnableRequested',
    })
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('surfaces an unreachable flags upstream as a retryable 502 dependency_failure', async () => {
    const { request } = setupGatewayTest(dummyContent, { flags: unreachableFlags() })
    const res = await request.get(`/api/communities/${SAMPLE.community}/flags/donations`)
    const problem = expectRFC7807(res.json, { status: 502, failureDomain: 'dependency_failure' })
    expect(problem.type).toBe('https://qaroom.dev/errors/flags-unreachable')
  })
})
