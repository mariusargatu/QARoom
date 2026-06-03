import fc from 'fast-check'
import { ulidArb, userIdArb } from './ids'

/** A community id with the `comm_` prefix and a valid 26-char Crockford body. */
export const communityIdArb = ulidArb.map((u) => `comm_${u}`)
/** A signing-key id (`kid`) with the `key_` prefix. */
export const keyIdArb = ulidArb.map((u) => `key_${u}`)

const LOWER_ALNUM_UNDERSCORE = 'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')
const handleArb = fc
  .array(fc.constantFrom(...LOWER_ALNUM_UNDERSCORE), { minLength: 2, maxLength: 40 })
  .map((chars) => chars.join(''))
const slugArb = fc
  .array(fc.constantFrom(...LOWER_ALNUM_UNDERSCORE), { minLength: 2, maxLength: 64 })
  .map((chars) => chars.join(''))

/** Membership role. */
export const roleArb = fc.constantFrom('owner', 'moderator', 'member')

/** Arbitrary `CreateUserRequest` body. display_name uses fc.string (can emit a NUL — parity, see roundtrip). */
export const createUserRequestArb = fc.record({
  handle: handleArb,
  display_name: fc.string({ minLength: 1, maxLength: 120 }),
})

/** Arbitrary `CreateCommunityRequest` body. */
export const createCommunityRequestArb = fc.record({
  slug: slugArb,
  name: fc.string({ minLength: 1, maxLength: 120 }),
})

/** Arbitrary `AddMembershipRequest` body. */
export const addMembershipRequestArb = fc.record({
  user_id: userIdArb,
  role: roleArb,
})

/** Arbitrary `CreateSessionRequest` body. */
export const createSessionRequestArb = fc.record({ user_id: userIdArb })

/** One `{community_id, role}` membership claim. */
export const membershipClaimArb = fc.record({
  community_id: communityIdArb,
  role: roleArb,
})

/** A set of membership claims as carried in a JWT. */
export const membershipsArb = fc.array(membershipClaimArb, { maxLength: 5 })
