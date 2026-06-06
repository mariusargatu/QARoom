import { describe, expect, it } from 'vitest'
import { DonationStateChangedEvent } from './donation-state-changed'
import { DonationStateChangedEventV1 } from './donation-state-changed.v1'
import { FlagStateChangedEvent } from './flag-state-changed'
import { FlagStateChangedEventV1 } from './flag-state-changed.v1'
import { ModerationDecisionRecordedEvent } from './moderation-decision-recorded'
import { ModerationDecisionRecordedEventV1 } from './moderation-decision-recorded.v1'
import { ModerationDecisionRecordedEventV2 } from './moderation-decision-recorded.v2'
import { PostCreatedEvent } from './post-created'
import { PostCreatedEventV1 } from './post-created.v1'
import { VoteCastEvent } from './vote-cast'
import { VoteCastEventV1 } from './vote-cast.v1'

// Canonical samples built to the LIVE schema — i.e., what a current producer emits.
const currentPostCreated = PostCreatedEvent.parse({
  event_id: 'evt_00000000000000000000000000',
  post_id: 'post_00000000000000000000000000',
  community_id: 'comm_00000000000000000000000000',
  author_id: 'user_00000000000000000000000000',
  title: 'a title',
  body: 'a body',
  created_at: '2026-06-03T00:00:00.000Z',
})

const currentVoteCast = VoteCastEvent.parse({
  event_id: 'evt_00000000000000000000000001',
  post_id: 'post_00000000000000000000000000',
  community_id: 'comm_00000000000000000000000000',
  voter_id: 'user_00000000000000000000000000',
  value: 1,
  score: 1,
  cast_at: '2026-06-03T00:00:00.000Z',
})

const currentFlagStateChanged = FlagStateChangedEvent.parse({
  event_id: 'evt_00000000000000000000000002',
  community_id: 'comm_00000000000000000000000000',
  flag_key: 'donations',
  from_state: 'Off',
  to_state: 'Enabling',
  rollout_event: 'EnableRequested',
  enabled: false,
  occurred_at: '2026-06-03T00:00:00.000Z',
})

const currentDonationStateChanged = DonationStateChangedEvent.parse({
  event_id: 'evt_00000000000000000000000003',
  community_id: 'comm_00000000000000000000000000',
  donation_id: 'dntn_00000000000000000000000000',
  donor_id: 'user_00000000000000000000000000',
  amount_cents: 2500,
  currency: 'USD',
  status: 'Captured',
  occurred_at: '2026-06-03T00:00:00.000Z',
})

const currentModerationDecisionRecorded = ModerationDecisionRecordedEvent.parse({
  event_id: 'evt_00000000000000000000000004',
  decision_id: 'mdec_00000000000000000000000000',
  post_id: 'post_00000000000000000000000000',
  community_id: 'comm_00000000000000000000000000',
  author_id: 'user_00000000000000000000000000',
  disposition: 'remove',
  cited_rules: ['no-harassment'],
  precedents: ['removed: targeted slur against an individual (mdec_…0001)'],
  departs_from_precedent: false,
  rationale: 'targets an individual with a slur, matching the cited no-harassment rule',
  confidence: 0.93,
  model: 'openai:gpt-5.5-2026-04-23',
  occurred_at: '2026-06-03T00:00:00.000Z',
})

// A frozen v1-shaped literal — what a pre-M12 producer emitted. Kept so the v1 schema stays exercised
// even though the LIVE producer no longer emits this shape (see the v2 note below).
const frozenV1ModerationDecisionRecorded = {
  event_id: 'evt_00000000000000000000000005',
  decision_id: 'mdec_00000000000000000000000001',
  post_id: 'post_00000000000000000000000000',
  community_id: 'comm_00000000000000000000000000',
  author_id: 'user_00000000000000000000000000',
  verdict: 'flag',
  rule_id: 'no-harassment',
  reason: 'targets an individual with a slur',
  confidence: 0.93,
  model: 'openai:gpt-5.5-2026-04-23',
  occurred_at: '2026-06-03T00:00:00.000Z',
}

describe('a frozen v1 consumer still parses the current producer output', () => {
  it('parses a current PostCreatedEvent under the frozen v1 schema', () => {
    expect(() => PostCreatedEventV1.parse(currentPostCreated)).not.toThrow()
  })

  it('parses a current VoteCastEvent under the frozen v1 schema', () => {
    expect(() => VoteCastEventV1.parse(currentVoteCast)).not.toThrow()
  })

  it('parses a current FlagStateChangedEvent under the frozen v1 schema', () => {
    expect(() => FlagStateChangedEventV1.parse(currentFlagStateChanged)).not.toThrow()
  })

  it('parses a current DonationStateChangedEvent under the frozen v1 schema', () => {
    expect(() => DonationStateChangedEventV1.parse(currentDonationStateChanged)).not.toThrow()
  })

  // Moderation is the ONE event that broke compatibility (Milestone 12, ADR-0020): v2 dropped the
  // two-valued `verdict` for a three-valued `disposition` + citation fields, because a grounded agent
  // that abstains needs a third state v1 cannot express. So unlike the four additive siblings above,
  // the CURRENT producer output parses under v2 — NOT v1 — and the version header bumped 1→2. We still
  // exercise v1 against a frozen v1-shaped literal so the frozen record keeps earning its place.
  it('parses a current ModerationDecisionRecordedEvent under the frozen v2 schema', () => {
    expect(() =>
      ModerationDecisionRecordedEventV2.parse(currentModerationDecisionRecorded),
    ).not.toThrow()
  })

  it('the frozen v1 schema still parses a frozen v1-shaped moderation literal', () => {
    expect(() =>
      ModerationDecisionRecordedEventV1.parse(frozenV1ModerationDecisionRecorded),
    ).not.toThrow()
  })

  it('a current v2 moderation event does NOT parse under v1 (the break is real and versioned)', () => {
    expect(() =>
      ModerationDecisionRecordedEventV1.parse(currentModerationDecisionRecorded),
    ).toThrow()
  })
})
