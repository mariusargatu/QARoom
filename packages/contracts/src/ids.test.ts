import { describe, expect, it } from 'vitest'
import { CommentId, CommunityId, DonationId, ID_PREFIXES, PostId, UserId } from './ids'

const ULID = '01HZY0K7M3QF8VN2J5RX9TB4CD'

const cases = [
  { name: 'UserId', schema: UserId, prefix: ID_PREFIXES.UserId },
  { name: 'CommunityId', schema: CommunityId, prefix: ID_PREFIXES.CommunityId },
  { name: 'PostId', schema: PostId, prefix: ID_PREFIXES.PostId },
  { name: 'CommentId', schema: CommentId, prefix: ID_PREFIXES.CommentId },
  { name: 'DonationId', schema: DonationId, prefix: ID_PREFIXES.DonationId },
] as const

describe('branded id parsers', () => {
  it.each(cases)('$name accepts a value carrying its own prefix', ({ schema, prefix }) => {
    const value = `${prefix}_${ULID}`
    expect(schema.parse(value)).toBe(value)
  })

  it.each(cases)('$name rejects a value carrying a foreign prefix', ({ schema, prefix }) => {
    const foreign = prefix === 'user' ? 'comm' : 'user'
    expect(() => schema.parse(`${foreign}_${ULID}`)).toThrow()
  })

  it.each(cases)('$name rejects a malformed ulid body', ({ schema, prefix }) => {
    expect(() => schema.parse(`${prefix}_not-a-ulid`)).toThrow()
  })

  it('every branded prefix is distinct so an id of one type cannot parse as another', () => {
    const prefixes = Object.values(ID_PREFIXES)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
})
