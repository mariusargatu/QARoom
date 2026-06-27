import { test } from '@fast-check/vitest'
import { idempotencyKeyArb, unicodeCreatePostRequestArb } from '@qaroom/testing-utils/generators'
import { withResource } from '@qaroom/testing-utils/harness'
import { describe, expect } from 'vitest'
import { SAMPLE, setupContentTest } from '../tests/harness'

describe('idempotent post creation (property)', () => {
  test.prop([unicodeCreatePostRequestArb, idempotencyKeyArb], { numRuns: 10 })(
    'creating a post twice with the same Idempotency-Key yields one post and an identical response',
    (body, key) =>
      withResource(
        () => setupContentTest(),
        async (ctx) => {
          // Bodies are Unicode-rich (emoji, bidi controls, NFD forms, at-limit) yet always
          // contract-valid, so the replay path is proven to preserve global text byte-identical
          // through the `idempotency_responses` store, not just ASCII.
          const first = await ctx.request.post(
            `/api/communities/${SAMPLE.communityA}/posts`,
            body,
            {
              'idempotency-key': key,
            },
          )
          const second = await ctx.request.post(
            `/api/communities/${SAMPLE.communityA}/posts`,
            body,
            {
              'idempotency-key': key,
            },
          )
          const state = await ctx.request.get('/system/state')

          expect(first.status).toBe(201)
          expect(second.json).toEqual(first.json)
          expect((state.json as { models: { posts: { count: number } } }).models.posts.count).toBe(
            1,
          )
        },
      ),
  )
})

describe('user-content fidelity (property)', () => {
  // The injected text round-trips exactly: a normalization (`.normalize`), truncation (code-unit
  // miscount on a max-length title), or transcoding bug would diverge `created`/`read` from `body`.
  // The GET re-reads from Postgres, so this also proves the text column + driver + JSON storage path.
  test.prop([unicodeCreatePostRequestArb, idempotencyKeyArb], { numRuns: 10 })(
    'a post returns and persists its title and body byte-identical, including emoji, bidi controls, NFD forms, and at-limit titles',
    (body, key) =>
      withResource(
        () => setupContentTest(),
        async (ctx) => {
          const created = await ctx.request.post(
            `/api/communities/${SAMPLE.communityA}/posts`,
            body,
            { 'idempotency-key': key },
          )
          expect(created.status).toBe(201)
          const post = created.json as { id: string; title: string; body: string }
          expect(post.title).toBe(body.title)
          expect(post.body).toBe(body.body)

          const fetched = await ctx.request.get(`/api/posts/${post.id}`)
          const read = fetched.json as { title: string; body: string }
          expect(read.title).toBe(body.title)
          expect(read.body).toBe(body.body)
        },
      ),
  )
})

// --- Boundary 5 (Temporal) NAME (T16) ---
// The injected `Clock` (Commitment 6) guarantees *determinism* of wall-clock reads — same seed, same
// `clock.now()` sequence — NOT *correctness* of calendar arithmetic. No date-bounded feature exists in
// v1: the only time logic is duration-based (the `gcDedup` TTL cutoff, `clock.now() - 24h`), which is
// determinism-covered and calendar-insensitive. There is no flag-expiry / donation window, so DST,
// month/year rollover, and multi-locale "today" have nothing to act on here — N/A-for-v1. Add a
// rollover + multi-locale-today property only when a date-bounded feature lands. (The Boundary-5 row in
// ARCHITECTURE.md is a gated projection of the boundary-registry invariant manifest, so this
// determinism-vs-time-math distinction is recorded here and in the PR, not by editing the manifest.)
//
// Votes (the other write path) carry no free-text field — `voter_id` + `value ±1` — so the Unicode
// surface lives on the post title/body wired above; there is nothing to fuzz on the vote body.
