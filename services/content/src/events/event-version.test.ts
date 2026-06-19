import { POST_CREATED_VERSION, VOTE_CAST_VERSION } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'

/**
 * EVENT-VERSION TRIPWIRE (TEST-MAP wiring improvement #4). Content's post/vote events are at v1 and
 * additive. This guard fails the moment either version constant is bumped, forcing the
 * version-evolution conversation (a new versioned schema + a consumer/upcaster taught to handle it,
 * the way moderation went 1→2 under ADR-0020) rather than a number silently shipping ahead of any
 * consumer.
 *
 * The REAL producer→wire agreement (that the emitted `event-version` header equals the schema
 * version) is verified end-to-end on a CAPTURED envelope in
 * `tests/contracts/post-created.message.provider.spec.ts` (it asserts `event-version === '1'` off a
 * real relay drain). The header-builder's faithful serialization of the field is pinned in
 * `@qaroom/messaging`'s `headers.test.ts`. This file deliberately owns ONLY the intentional-bump
 * tripwire — not a `String(X) === String(X)` restatement of those.
 */
describe('content event versions are at the additive v1 baseline', () => {
  it('post.created is v1 — a bump must land with a versioned schema + consumer upcast', () => {
    expect(POST_CREATED_VERSION).toBe(1)
  })

  it('vote.cast is v1 — a bump must land with a versioned schema + consumer upcast', () => {
    expect(VOTE_CAST_VERSION).toBe(1)
  })
})
