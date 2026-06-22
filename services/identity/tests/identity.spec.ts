import { EXAMPLE_USER_ID } from '@qaroom/contracts'
import {
  expectCapabilitiesCover,
  expectProblemContentType,
  expectRFC7807,
} from '@qaroom/testing-utils/matchers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OPERATIONS } from '../src/operations'
import { SAMPLE, setupIdentityTest } from './harness'

type Ctx = Awaited<ReturnType<typeof setupIdentityTest>>

const MISSING_COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4ZZ'

describe('identity-service HTTP behaviour', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = await setupIdentityTest()
  })

  afterEach(async () => {
    await ctx.close()
  })

  const createUser = (handle: string) =>
    ctx.request.post(
      '/api/users',
      { handle, display_name: 'Ada Lovelace' },
      { 'idempotency-key': `user-${handle}` },
    )

  it('creating a user returns 201 with a branded user id', async () => {
    const res = await createUser('ada')
    expect(res.status).toBe(201)
    expect((res.json as { id: string }).id).toMatch(/^user_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('creating a community whose slug is already taken returns a 409 conflict problem', async () => {
    // 'general' is the seeded community's slug, so this collides.
    const res = await ctx.request.post(
      '/api/communities',
      { slug: 'general', name: 'Impostor' },
      { 'idempotency-key': 'dup-slug' },
    )
    expectProblemContentType(res.contentType)
    expectRFC7807(res.json, { status: 409, failureDomain: 'conflict' })
  })

  it('adding a member to a non-existent community is rejected as a 404 in the tenant_resolution domain', async () => {
    const res = await ctx.request.post(
      `/api/communities/${MISSING_COMMUNITY}/members`,
      { user_id: EXAMPLE_USER_ID, role: 'member' },
      { 'idempotency-key': 'no-comm' },
    )
    expectProblemContentType(res.contentType)
    expectRFC7807(res.json, { status: 404, failureDomain: 'tenant_resolution' })
  })

  it('createSession issues a Bearer token whose decoded sub and memberships match the registry', async () => {
    const userId = (await createUser('bob')).json as { id: string }
    await ctx.request.post(
      `/api/communities/${SAMPLE.communityGeneral}/members`,
      { user_id: userId.id, role: 'member' },
      { 'idempotency-key': 'join-general' },
    )
    const res = await ctx.request.post(
      '/api/sessions',
      { user_id: userId.id },
      { 'idempotency-key': 'session-1' },
    )
    expect(res.status).toBe(201)
    const body = res.json as { access_token: string; token_type: string; kid: string }
    expect(body.token_type).toBe('Bearer')
    const claims = await ctx.issuer.verify(body.access_token)
    expect(claims.sub).toBe(userId.id)
    expect(claims.memberships.map((m) => m.community_id)).toContain(SAMPLE.communityGeneral)
  })

  it('the session token carries each membership role exactly as granted (moderator and owner are not collapsed)', async () => {
    const userId = (await createUser('mallory')).json as { id: string }
    const staff = (
      await ctx.request.post(
        '/api/communities',
        { slug: 'staff', name: 'Staff' },
        { 'idempotency-key': 'comm-staff' },
      )
    ).json as { id: string }
    // Grant DISTINCT roles in two communities so a hardcoded role collapses at least one of them.
    await ctx.request.post(
      `/api/communities/${SAMPLE.communityGeneral}/members`,
      { user_id: userId.id, role: 'moderator' },
      { 'idempotency-key': 'join-mod' },
    )
    await ctx.request.post(
      `/api/communities/${staff.id}/members`,
      { user_id: userId.id, role: 'owner' },
      { 'idempotency-key': 'join-owner' },
    )
    const res = await ctx.request.post(
      '/api/sessions',
      { user_id: userId.id },
      { 'idempotency-key': 'session-roles' },
    )
    expect(res.status).toBe(201)
    const claims = await ctx.issuer.verify((res.json as { access_token: string }).access_token)
    const roleFor = (communityId: string) =>
      claims.memberships.find((m) => m.community_id === communityId)?.role
    expect(roleFor(SAMPLE.communityGeneral)).toBe('moderator')
    expect(roleFor(staff.id)).toBe('owner')
  })

  it('the JWKS endpoint serves the ES256 signing key whose kid matches the issued token', async () => {
    const userId = (await createUser('carol')).json as { id: string }
    const session = (
      await ctx.request.post('/api/sessions', { user_id: userId.id }, { 'idempotency-key': 's2' })
    ).json as { kid: string }
    const jwks = await ctx.request.get('/jwks.json')
    const keys = (jwks.json as { keys: Array<{ kid: string; alg: string }> }).keys
    expect(keys.length).toBeGreaterThanOrEqual(1)
    expect(keys.map((k) => k.kid)).toContain(session.kid)
    expect(keys.map((k) => k.alg)).toContain('ES256')
  })

  it('system capabilities lists every operation in the registry (no operation is silently omitted)', async () => {
    const res = await ctx.request.get('/system/capabilities')
    expectCapabilitiesCover(res.json, OPERATIONS)
  })

  it('a mutation without an Idempotency-Key is rejected as a 400 validation problem', async () => {
    const res = await ctx.request.post('/api/users', {
      handle: 'dave',
      display_name: 'Dave',
    })
    expectProblemContentType(res.contentType)
    expectRFC7807(res.json, { status: 400, failureDomain: 'validation' })
  })
})
