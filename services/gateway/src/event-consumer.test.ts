import { EXAMPLE_COMMUNITY_ID, EXAMPLE_DONATION_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { wsFrameFor } from './event-consumer'

const EVENT_ID = 'evt_01HZY0K7M3QF8VN2J5RX9TB4CP'
const WHEN = '2026-06-05T12:00:00.000Z'

const flagEvent = {
  event_id: EVENT_ID,
  community_id: EXAMPLE_COMMUNITY_ID,
  flag_key: 'donations',
  from_state: 'Canary',
  to_state: 'Enabled',
  rollout_event: 'RolloutCompleted',
  enabled: true,
  occurred_at: WHEN,
}

const donationEvent = {
  event_id: EVENT_ID,
  community_id: EXAMPLE_COMMUNITY_ID,
  donation_id: EXAMPLE_DONATION_ID,
  donor_id: EXAMPLE_USER_ID,
  amount_cents: 2500,
  currency: 'USD',
  status: 'Captured',
  occurred_at: WHEN,
}

/**
 * `wsFrameFor` is the PURE part of the WS feed consumer (the rest needs a broker). The two event
 * shapes are mutually exclusive, so it discriminates by `safeParse` without an event-name header.
 */
describe('wsFrameFor', () => {
  it('maps a FlagStateChangedEvent payload to a flag.state.changed frame', () => {
    expect(wsFrameFor(flagEvent)).toEqual({
      type: 'flag.state.changed',
      community_id: EXAMPLE_COMMUNITY_ID,
      occurred_at: WHEN,
      flag_key: 'donations',
      state: 'Enabled',
      enabled: true,
    })
  })

  it('maps a DonationStateChangedEvent payload to a donation.state.changed frame', () => {
    expect(wsFrameFor(donationEvent)).toEqual({
      type: 'donation.state.changed',
      community_id: EXAMPLE_COMMUNITY_ID,
      occurred_at: WHEN,
      donation_id: EXAMPLE_DONATION_ID,
      donor_id: EXAMPLE_USER_ID,
      amount_cents: 2500,
      currency: 'USD',
      status: 'Captured',
    })
  })

  it('returns null for a payload matching neither event shape', () => {
    expect(wsFrameFor({ foo: 'bar' })).toBeNull()
    expect(wsFrameFor({ event_id: EVENT_ID, community_id: EXAMPLE_COMMUNITY_ID })).toBeNull()
  })
})
