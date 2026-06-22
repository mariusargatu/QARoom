import { describe, expect, it } from 'vitest'
import { EXAMPLE_COMMUNITY_ID } from './examples'
import { CommunityId } from './ids'
import { donationsForCommunity, flagsForCommunity, subjectMatchesFilter } from './subjects'

const community = CommunityId.parse(EXAMPLE_COMMUNITY_ID)

describe('tenant-scoped subscription builders', () => {
  it('builds a single-community flags subscription with a trailing wildcard', () => {
    expect(flagsForCommunity(community)).toBe(`qaroom.flags.flag.${community}.>`)
  })

  it('builds a single-community donations subscription with a trailing wildcard', () => {
    expect(donationsForCommunity(community)).toBe(`qaroom.donations.donation.${community}.>`)
  })

  it('selects only the owning community when the tenant-scoped flags filter is applied', () => {
    const other = CommunityId.parse('comm_01HZY0K7M3QF8VN2J5RX9TB400')
    expect(
      subjectMatchesFilter(flagsForCommunity(community), `qaroom.flags.flag.${community}.changed`),
    ).toBe(true)
    expect(
      subjectMatchesFilter(flagsForCommunity(community), `qaroom.flags.flag.${other}.changed`),
    ).toBe(false)
  })
})
