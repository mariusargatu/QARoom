import {
  EXAMPLE_AS_OF,
  EXAMPLE_COMMUNITY,
  EXAMPLE_DECISION_ID,
  EXAMPLE_MEMBERSHIP,
  EXAMPLE_MODERATION_DECISION,
  EXAMPLE_TICKET_ID,
  EXAMPLE_USER,
  EXAMPLE_USER_ID,
} from '@qaroom/contracts'
import {
  expectLamportAdvanced,
  expectProblemContentType,
  expectRFC7807,
  lamportOf,
} from '@qaroom/testing-utils/matchers'
import { describe, expect, it } from 'vitest'
import type { IdentityClient } from '../src/clients/identity-client'
import type { ClientResponse } from '../src/resilience/upstream-call'
import {
  constantContent,
  constantIdentity,
  constantModerator,
  SAMPLE,
  setupGatewayTest,
  unreachableIdentity,
  unreachableModerator,
} from './harness'

const dummyContent = constantContent({ status: 200, body: {}, contentType: 'application/json' })
const json = (status: number, body: unknown) =>
  ({ status, body, contentType: 'application/json' }) as const

describe('gateway → identity proxy', () => {
  it('proxies a created user through unchanged and advances the lamport', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      identity: constantIdentity(json(201, EXAMPLE_USER)),
    })
    const before = lamportOf((await request.get('/system/state')).json)
    const res = await request.post(
      '/api/users',
      { handle: EXAMPLE_USER.handle, display_name: EXAMPLE_USER.display_name },
      { 'idempotency-key': 'u1' },
    )
    expect(res.status).toBe(201)
    expect(res.json).toEqual(EXAMPLE_USER)
    const after = lamportOf((await request.get('/system/state')).json)
    expectLamportAdvanced(before, after)
  })

  it('rejects createUser without an Idempotency-Key at the edge with a 400', async () => {
    const { request } = setupGatewayTest(dummyContent, { identity: unreachableIdentity() })
    const res = await request.post('/api/users', {
      handle: EXAMPLE_USER.handle,
      display_name: EXAMPLE_USER.display_name,
    })
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('rejects a malformed user id at the edge with a 400 and never calls the upstream', async () => {
    const { request } = setupGatewayTest(dummyContent, { identity: unreachableIdentity() })
    const res = await request.get('/api/users/not-a-user')
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('proxies getUser through unchanged', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      identity: constantIdentity(json(200, EXAMPLE_USER)),
    })
    const res = await request.get(`/api/users/${EXAMPLE_USER_ID}`)
    expect(res.status).toBe(200)
    expect(res.json).toEqual(EXAMPLE_USER)
  })

  it('proxies a created community through unchanged', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      identity: constantIdentity(json(201, EXAMPLE_COMMUNITY)),
    })
    const res = await request.post(
      '/api/communities',
      { slug: EXAMPLE_COMMUNITY.slug, name: EXAMPLE_COMMUNITY.name },
      { 'idempotency-key': 'c1' },
    )
    expect(res.status).toBe(201)
    expect(res.json).toEqual(EXAMPLE_COMMUNITY)
  })

  it('proxies addMembership and rejects a malformed community id at the edge', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      identity: constantIdentity(json(201, EXAMPLE_MEMBERSHIP)),
    })
    const ok = await request.post(
      `/api/communities/${SAMPLE.community}/members`,
      { user_id: EXAMPLE_USER_ID, role: 'member' },
      { 'idempotency-key': 'm1' },
    )
    expect(ok.status).toBe(201)
    const bad = await request.post(
      '/api/communities/not-a-community/members',
      { user_id: EXAMPLE_USER_ID, role: 'member' },
      { 'idempotency-key': 'm2' },
    )
    expectRFC7807(bad.json, { status: 400, failureDomain: 'validation' })
  })

  it('proxies listMembers through unchanged', async () => {
    const memberList = {
      community_id: SAMPLE.community,
      members: [EXAMPLE_MEMBERSHIP],
      as_of: EXAMPLE_AS_OF,
    }
    const { request } = setupGatewayTest(dummyContent, {
      identity: constantIdentity(json(200, memberList)),
    })
    const res = await request.get(`/api/communities/${SAMPLE.community}/members`)
    expect(res.status).toBe(200)
    expect(res.json).toEqual(memberList)
  })

  it('proxies createSession through unchanged', async () => {
    const token = {
      session_id: 'sess_01HZY0K7M3QF8VN2J5RX9TB4CG',
      access_token: 'eyJ.test.token',
      token_type: 'Bearer',
      expires_at: '2026-05-28T12:00:00.000Z',
      kid: 'key_01HZY0K7M3QF8VN2J5RX9TB4CH',
    }
    const { request } = setupGatewayTest(dummyContent, {
      identity: constantIdentity(json(201, token)),
    })
    const res = await request.post(
      '/api/sessions',
      { user_id: EXAMPLE_USER_ID },
      { 'idempotency-key': 's1' },
    )
    expect(res.status).toBe(201)
    expect(res.json).toEqual(token)
  })

  it('forwards the Authorization bearer to identity when minting a WS ticket', async () => {
    let seen: string | undefined
    const capturing: IdentityClient = {
      ...constantIdentity(json(201, { ticket: EXAMPLE_TICKET_ID, expires_in_seconds: 30 })),
      createWsTicket: async (authorization): Promise<ClientResponse> => {
        seen = authorization
        return json(201, { ticket: EXAMPLE_TICKET_ID, expires_in_seconds: 30 })
      },
    }
    const { request } = setupGatewayTest(dummyContent, { identity: capturing })
    const res = await request.post('/ws/tickets', {}, { authorization: 'Bearer test.jwt' })
    expect(res.status).toBe(201)
    expect(seen).toBe('Bearer test.jwt')
  })

  it('surfaces an unreachable identity upstream as a retryable 502 dependency_failure', async () => {
    const { request } = setupGatewayTest(dummyContent, { identity: unreachableIdentity() })
    const res = await request.get(`/api/communities/${SAMPLE.community}/members`)
    expectProblemContentType(res.contentType)
    const problem = expectRFC7807(res.json, { status: 502, failureDomain: 'dependency_failure' })
    expect(problem.type).toBe('https://qaroom.dev/errors/identity-unreachable')
    expect(problem.retryable).toBe(true)
  })
})

describe('gateway → moderation proxy', () => {
  it('proxies a list of moderation decisions through unchanged', async () => {
    const list = { decisions: [EXAMPLE_MODERATION_DECISION], as_of: EXAMPLE_AS_OF }
    const { request } = setupGatewayTest(dummyContent, {
      moderator: constantModerator(json(200, list)),
    })
    const res = await request.get(`/api/communities/${SAMPLE.community}/moderation-decisions`)
    expect(res.status).toBe(200)
    expect(res.json).toEqual(list)
  })

  it('proxies a single moderation decision through unchanged', async () => {
    const { request } = setupGatewayTest(dummyContent, {
      moderator: constantModerator(json(200, EXAMPLE_MODERATION_DECISION)),
    })
    const res = await request.get(
      `/api/communities/${SAMPLE.community}/moderation-decisions/${EXAMPLE_DECISION_ID}`,
    )
    expect(res.status).toBe(200)
    expect(res.json).toEqual(EXAMPLE_MODERATION_DECISION)
  })

  it('rejects a malformed decision id at the edge with a 400 and never calls the upstream', async () => {
    const { request } = setupGatewayTest(dummyContent, { moderator: unreachableModerator() })
    const res = await request.get(
      `/api/communities/${SAMPLE.community}/moderation-decisions/not-a-decision`,
    )
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })

  it('surfaces an unreachable moderator upstream as a retryable 502 dependency_failure', async () => {
    const { request } = setupGatewayTest(dummyContent, { moderator: unreachableModerator() })
    const res = await request.get(`/api/communities/${SAMPLE.community}/moderation-decisions`)
    const problem = expectRFC7807(res.json, { status: 502, failureDomain: 'dependency_failure' })
    expect(problem.type).toBe('https://qaroom.dev/errors/moderator-unreachable')
  })
})
