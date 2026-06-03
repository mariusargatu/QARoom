import fc from 'fast-check'
import { userIdArb } from './ids'

/** Arbitrary `CreatePostRequest` body. */
export const createPostRequestArb = fc.record({
  author_id: userIdArb,
  title: fc.string({ minLength: 1, maxLength: 300 }),
  body: fc.string({ maxLength: 4000 }),
})

/** Vote direction: +1 or -1. */
export const voteValueArb = fc.constantFrom(1, -1)

/** Arbitrary `CastVoteRequest` body. */
export const castVoteRequestArb = fc.record({
  voter_id: userIdArb,
  value: voteValueArb,
})
