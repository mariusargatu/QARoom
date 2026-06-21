import { VOTE_VALUES } from '@qaroom/contracts'
import fc from 'fast-check'
import { userIdArb } from './ids'

/** Arbitrary `CreatePostRequest` body. */
export const createPostRequestArb = fc.record({
  author_id: userIdArb,
  title: fc.string({ minLength: 1, maxLength: 300 }),
  body: fc.string({ maxLength: 4000 }),
})

/**
 * Vote direction, DERIVED from the single `VOTE_VALUES` source in @qaroom/contracts (was a duplicate
 * `fc.constantFrom(1, -1)` — the exact two-places-hardcoded smell the invariant work removes). Not
 * via zod-fast-check: that bridge pins zod 3 / fast-check 3 and the repo is on zod 4 / fast-check 4;
 * deriving from the shared constant gives the same one-definition guarantee without a second
 * derivation engine. The vote-value property test cross-checks every drawn value against
 * `VoteValue.parse`, so this arbitrary cannot silently drift from the schema.
 */
export const voteValueArb = fc.constantFrom(...VOTE_VALUES)

/** Arbitrary `CastVoteRequest` body. */
export const castVoteRequestArb = fc.record({
  voter_id: userIdArb,
  value: voteValueArb,
})
