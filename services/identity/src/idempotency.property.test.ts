import { test } from '@fast-check/vitest'
import { createUserRequestArb, idempotencyKeyArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import { describe, expect } from 'vitest'
import { setupIdentityTest } from '../tests/harness'

/**
 * Idempotency-Key replay as a property (Commitment 4): replaying a mutation with the same
 * key + body must produce the identical response and no second observable effect. For
 * session issuance this is sharper than for content — a non-idempotent createSession would
 * mint a second token AND a second signing key on replay.
 */
describe('identity idempotency (property)', () => {
  test.prop([idempotencyKeyArb], { numRuns: 10 })(
    'replaying createSession with the same Idempotency-Key returns the original token and mints no second session or key',
    (key) =>
      withResource(
        () => setupIdentityTest(),
        async (ctx) => {
          const user = (
            await ctx.request.post(
              '/api/users',
              { handle: 'ada', display_name: 'Ada' },
              { 'idempotency-key': 'u' },
            )
          ).json as { id: string }
          const first = await ctx.request.post(
            '/api/sessions',
            { user_id: user.id },
            { 'idempotency-key': key },
          )
          const replay = await ctx.request.post(
            '/api/sessions',
            { user_id: user.id },
            { 'idempotency-key': key },
          )
          const state = (await ctx.request.get('/system/state')).json as {
            models: { sessions: { count: number }; signing_keys: { total_count: number } }
          }

          expect(replay.json).toEqual(first.json)
          expect(state.models.sessions.count).toBe(1)
          expect(state.models.signing_keys.total_count).toBe(1)
        },
      ),
  )

  test.prop([idempotencyKeyArb, createUserRequestArb], { numRuns: 10 })(
    'replaying createUser with the same Idempotency-Key returns the original user and creates no second user',
    (key, body) =>
      withResource(
        () => setupIdentityTest(),
        async (ctx) => {
          const first = await ctx.request.post('/api/users', body, { 'idempotency-key': key })
          const replay = await ctx.request.post('/api/users', body, { 'idempotency-key': key })
          const state = (await ctx.request.get('/system/state')).json as {
            models: { users: { count: number } }
          }

          expect(replay.json).toEqual(first.json)
          expect(state.models.users.count).toBe(1)
        },
      ),
  )
})
