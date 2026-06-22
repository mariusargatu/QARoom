import { EXAMPLE_USER_ID } from '@qaroom/contracts'
import { expectProblemContentType, expectRFC7807 } from '@qaroom/testing-utils/matchers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SAMPLE, setupIdentityTest } from './harness'

type Ctx = Awaited<ReturnType<typeof setupIdentityTest>>

/**
 * The read-user route, the create-session not-found branch, and the duplicate-membership
 * conflict had no HTTP coverage — they exercise the `userNotFoundProblem` contract and the
 * `membership-exists` 409, which the happy-path suite never reaches.
 */
// A well-formed branded UserId that is never created in these tests (parses, but is absent).
const ABSENT_USER = 'user_01HZY0K7M3QF8VN2J5RX9TB4ZZ'

describe('identity-service read + not-found routes', () => {
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

  it('reads a created user back by id with a 200 and the stored fields', async () => {
    const created = (await createUser('ada')).json as { id: string; handle: string }

    const res = await ctx.request.get(`/api/users/${created.id}`)

    expect(res.status).toBe(200)
    expect(res.json).toEqual(created)
  })

  it('reading an unknown but well-formed user id returns a 404 in the not_found domain', async () => {
    const res = await ctx.request.get(`/api/users/${ABSENT_USER}`)

    expect(res.status).toBe(404)
    expectProblemContentType(res.contentType)
    const body = expectRFC7807(res.json, { status: 404, failureDomain: 'not_found' })
    expect(body.detail).toContain(ABSENT_USER)
  })

  it('creating a session for an unknown user is rejected as a 404 not_found problem', async () => {
    const res = await ctx.request.post(
      '/api/sessions',
      { user_id: ABSENT_USER },
      { 'idempotency-key': 'session-absent' },
    )

    expect(res.status).toBe(404)
    expectProblemContentType(res.contentType)
    expectRFC7807(res.json, { status: 404, failureDomain: 'not_found' })
  })

  it('adding the same member to a community twice returns a 409 conflict on the second add', async () => {
    const user = (await createUser('bob')).json as { id: string }
    const first = await ctx.request.post(
      `/api/communities/${SAMPLE.communityGeneral}/members`,
      { user_id: user.id, role: 'member' },
      { 'idempotency-key': 'join-once' },
    )
    expect(first.status).toBe(201)

    const dup = await ctx.request.post(
      `/api/communities/${SAMPLE.communityGeneral}/members`,
      { user_id: user.id, role: 'moderator' },
      { 'idempotency-key': 'join-twice' },
    )

    expect(dup.status).toBe(409)
    expectProblemContentType(dup.contentType)
    const body = expectRFC7807(dup.json, { status: 409, failureDomain: 'conflict' })
    expect(body.detail).toContain(user.id)
  })

  it('the example user id from the contracts is also absent until created (read returns 404)', async () => {
    const res = await ctx.request.get(`/api/users/${EXAMPLE_USER_ID}`)

    expect(res.status).toBe(404)
    expectRFC7807(res.json, { status: 404, failureDomain: 'not_found' })
  })
})
