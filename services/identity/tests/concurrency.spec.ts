import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setupIdentityTest } from './harness'

type Ctx = Awaited<ReturnType<typeof setupIdentityTest>>

/**
 * Single-writer-per-resource invariants under concurrent requests (Commitment 4). The
 * "exactly one current signing key" partial-unique index + advisory lock, and the
 * unique-slug guard on community creation, are correctness-critical for a key/registry
 * service. These fire many requests at once and assert the invariant holds.
 *
 * Note: pglite is a single in-process connection, so it serializes these rather than
 * exercising true OS-level contention — that lands with Testcontainers later. What this
 * proves now is that the guard logic (lock → check → insert / partial-unique index) does
 * not double-write when requests overlap.
 */
describe('identity single-writer invariants under concurrent requests', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = await setupIdentityTest()
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('concurrent first sessions for a user mint exactly one signing key', async () => {
    const user = (
      await ctx.request.post(
        '/api/users',
        { handle: 'ada', display_name: 'Ada' },
        { 'idempotency-key': 'u' },
      )
    ).json as { id: string }

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        ctx.request.post('/api/sessions', { user_id: user.id }, { 'idempotency-key': `s${i}` }),
      ),
    )

    const state = (await ctx.request.get('/system/state')).json as {
      models: { signing_keys: { total_count: number; jwks_eligible_count: number } }
    }
    expect(state.models.signing_keys.total_count).toBe(1)
    expect(state.models.signing_keys.jwks_eligible_count).toBe(1)
  })

  it('concurrent community creates with the same slug yield exactly one community and the rest conflict', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        ctx.request.post(
          '/api/communities',
          { slug: 'contested', name: 'Contested' },
          { 'idempotency-key': `c${i}` },
        ),
      ),
    )
    const created = results.filter((r) => r.status === 201)
    const conflicts = results.filter((r) => r.status === 409)
    expect(created.length).toBe(1)
    expect(conflicts.length).toBe(7)

    const winnerId = (created[0]?.json as { id: string }).id
    const members = await ctx.request.get(`/api/communities/${winnerId}/members`)
    expect(members.status).toBe(200)
  })
})
