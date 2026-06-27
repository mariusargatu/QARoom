import { VOTE_VALUES, type VoteValueT } from '@qaroom/contracts'
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
 *
 * This is THE ungoverned Tier-2 deriver (ADR-0033, the T23 derivation chain): the CODEOWNED source is
 * `VOTE_VALUES`, but the function that derives the property generator from it is not — so the cheapest
 * tamper is to leave the invariant pristine and weaken the deriver here. `AGENT_WEAKEN_VOTE_DERIVER`
 * arms exactly that attack (spike C3): it broadens the emitted domain to admit an out-of-set value (a
 * `2`) while `VOTE_VALUES` stays `[1, -1]`. The deriver-conformance gate
 * (`packages/testing-utils/src/agentic/deriver-conformance.ts`) recomputes the expected set straight
 * from `VOTE_VALUES` and samples this arbitrary, so the broadened domain reds it — the fix for the
 * chain hole (spike C4). Read once at module load (construction-time), like the content fault seam.
 */
export const voteValueArb = deriveVoteValueArb()

/**
 * Build the vote-value arbitrary from the single `VOTE_VALUES` source. Exposed (not inlined) so the
 * derivation step is a named, governed surface and the conformance audit can name what it checks.
 * `AGENT_WEAKEN_VOTE_DERIVER` models the derivation-chain attack — it must be the ONLY conditional
 * here, and it is unguarded by design (the deriver-conformance gate is what catches it).
 */
export function deriveVoteValueArb(env: NodeJS.ProcessEnv = process.env): fc.Arbitrary<VoteValueT> {
  if (env.AGENT_WEAKEN_VOTE_DERIVER === '1') {
    // The weakened deriver: source untouched, but the emitted domain now admits an out-of-set value.
    // The cast is the lie the attack tells — the deriver still CLAIMS to emit `VoteValueT` while
    // emitting a `2`; the conformance gate samples the real output and catches the discrepancy.
    return fc.constantFrom(...VOTE_VALUES, 2) as fc.Arbitrary<VoteValueT>
  }
  return fc.constantFrom(...VOTE_VALUES)
}

/** Arbitrary `CastVoteRequest` body. */
export const castVoteRequestArb = fc.record({
  voter_id: userIdArb,
  value: voteValueArb,
})
