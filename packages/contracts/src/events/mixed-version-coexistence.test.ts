import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  FLAG_STATE_CHANGED_EVENT,
  FLAG_STATE_CHANGED_VERSION,
  FlagStateChangedEvent,
} from './flag-state-changed'
import { FlagStateChangedEventV1 } from './flag-state-changed.v1'
import {
  type Consumer,
  coexistenceBus,
  parserKey,
  versionAwareConsumer,
  versionNaiveConsumer,
  type WireMessage,
} from './mixed-version-coexistence.harness'
import {
  MODERATION_DECISION_RECORDED_EVENT,
  MODERATION_DECISION_RECORDED_VERSION,
  ModerationDecisionRecordedEvent,
} from './moderation-decision-recorded'
import { ModerationDecisionRecordedEventV1 } from './moderation-decision-recorded.v1'

/**
 * RUNTIME N/N+1 mixed-version coexistence (T13). `events.compat.test.ts` proves the AUTHOR-TIME
 * guarantee — a frozen v1 schema still parses the current producer's output. This file proves the
 * RUNTIME guarantee the chart's zero-unavailability rollout (deployment.yaml `strategy`) creates a
 * window for: during a rolling update an N pod and an N+1 pod consume the SAME stream at once. The
 * `./mixed-version-coexistence.harness` substrate models that fan-out (two consumers, one bus); this
 * file asserts what must hold for the rollout to be safe:
 *
 *   1. forward-compatible (additive) events — the N pod consumes the N+1 producer's output WITHOUT
 *      LOSS (additive changes never bump the version, per the repo's rule);
 *   2. the breaking change (moderation v1→v2, ADR-0020) — "an event written by v2 that v1 can't
 *      parse", the canonical microservices outage — is survived by a VERSION-AWARE consumer that
 *      quarantines a version it was not built for instead of crash-looping; and
 *   3. a deploy-then-rollback leaves state consistent (every event cleanly applied or cleanly
 *      quarantined — never half-applied).
 *
 * Tier-A (in-process, runs in `pnpm test`). The real cluster rollout/rollback drill (kubectl
 * rollout + chaos) and an Argo Rollouts canary are NAMEd Tier-B in the PR — they need a cluster.
 */

const ids = {
  community: 'comm_00000000000000000000000000',
  post: 'post_00000000000000000000000000',
  author: 'user_00000000000000000000000000',
}

/**
 * A FlagStateChangedEvent emitted by an N+1 producer that has grown an ADDITIVE field
 * (`rollout_percent`) the N pod never knew. Additive ⇒ no break ⇒ no version bump (the version
 * stays 1), so the N pod's frozen, non-strict v1 schema still parses it — dropping only the field
 * it was not built to read.
 */
const additiveFlagPayload = {
  event_id: 'evt_00000000000000000000000010',
  community_id: ids.community,
  flag_key: 'donations',
  from_state: 'Canary',
  to_state: 'Enabled',
  rollout_event: 'RolloutCompleted',
  enabled: true,
  occurred_at: '2026-06-03T00:00:00.000Z',
  // The N+1-only addition. An older consumer must tolerate it (conventions §2: non-strict events).
  rollout_percent: 100,
} as const

const additiveFlagMessage: WireMessage = {
  eventName: FLAG_STATE_CHANGED_EVENT,
  eventVersion: FLAG_STATE_CHANGED_VERSION,
  payload: additiveFlagPayload,
}

/** A v1 moderation event — `verdict ∈ {allow, flag}` — still in flight from a lagging N producer. */
const moderationV1Payload = {
  event_id: 'evt_00000000000000000000000020',
  decision_id: 'mdec_00000000000000000000000000',
  post_id: ids.post,
  community_id: ids.community,
  author_id: ids.author,
  verdict: 'flag',
  rule_id: 'no-harassment',
  reason: 'targets an individual with a slur',
  confidence: 0.93,
  model: 'openai:gpt-5.5-2026-04-23',
  occurred_at: '2026-06-03T00:00:00.000Z',
} as const

const moderationV1Message: WireMessage = {
  eventName: MODERATION_DECISION_RECORDED_EVENT,
  eventVersion: 1,
  payload: moderationV1Payload,
}

/** A v2 moderation event — the breaking, citation-bearing `disposition` shape (ADR-0020). */
const moderationV2Payload = {
  event_id: 'evt_00000000000000000000000021',
  decision_id: 'mdec_00000000000000000000000001',
  post_id: ids.post,
  community_id: ids.community,
  author_id: ids.author,
  disposition: 'remove',
  cited_rules: ['no-harassment'],
  precedents: ['removed: targeted slur against an individual (mdec_…0001)'],
  departs_from_precedent: false,
  rationale: 'targets an individual with a slur, matching the cited no-harassment rule',
  confidence: 0.93,
  model: 'openai:gpt-5.5-2026-04-23',
  occurred_at: '2026-06-03T00:00:00.000Z',
} as const

const moderationV2Message: WireMessage = {
  eventName: MODERATION_DECISION_RECORDED_EVENT,
  eventVersion: MODERATION_DECISION_RECORDED_VERSION,
  payload: moderationV2Payload,
}

const MOD_KEY_V1 = parserKey(MODERATION_DECISION_RECORDED_EVENT, 1)
const MOD_KEY_V2 = parserKey(MODERATION_DECISION_RECORDED_EVENT, 2)

/** An N+1 moderator pod: keeps BOTH parsers so it reads in-flight v1 AND v2 during the rollout. */
const moderatorNPlus1Pod = (): Consumer =>
  versionAwareConsumer(
    new Map<string, z.ZodType>([
      [MOD_KEY_V1, ModerationDecisionRecordedEventV1],
      [MOD_KEY_V2, ModerationDecisionRecordedEvent],
    ]),
  )

/** An N (or rolled-back-to-v1) moderator pod: only knows the v1 `verdict` shape. */
const moderatorNPod = (): Consumer =>
  versionAwareConsumer(new Map([[MOD_KEY_V1, ModerationDecisionRecordedEventV1]]))

// --- 1. forward-compatible (additive) coexistence: the N pod consumes N+1 WITHOUT LOSS ------------

describe('N/N+1 forward-compatible coexistence (additive flag event, no version bump)', () => {
  const FLAG_KEY_V1 = parserKey(FLAG_STATE_CHANGED_EVENT, 1)

  it('an N pod and an N+1 pod, bound to one stream at once, both consume the N+1 producer event', () => {
    const n = versionAwareConsumer(new Map([[FLAG_KEY_V1, FlagStateChangedEventV1]]))
    const nPlus1 = versionAwareConsumer(new Map([[FLAG_KEY_V1, FlagStateChangedEvent]]))
    const bus = coexistenceBus()
    bus.bind(n.handle)
    bus.bind(nPlus1.handle)

    bus.publish(additiveFlagMessage)

    expect(n.received).toHaveLength(1)
    expect(n.quarantined).toHaveLength(0)
    expect(nPlus1.received).toHaveLength(1)
    expect(nPlus1.quarantined).toHaveLength(0)
  })

  it('the N pod parses the N+1 event WITHOUT LOSS — every v1 field preserved exactly', () => {
    const parsed = FlagStateChangedEventV1.parse(additiveFlagPayload)
    expect(parsed).toEqual({
      event_id: additiveFlagPayload.event_id,
      community_id: additiveFlagPayload.community_id,
      flag_key: additiveFlagPayload.flag_key,
      from_state: additiveFlagPayload.from_state,
      to_state: additiveFlagPayload.to_state,
      rollout_event: additiveFlagPayload.rollout_event,
      enabled: additiveFlagPayload.enabled,
      occurred_at: additiveFlagPayload.occurred_at,
    })
  })

  it('the additive field is dropped (ignored), never silently mis-applied to a known field', () => {
    const parsed = FlagStateChangedEventV1.parse(additiveFlagPayload)
    expect('rollout_percent' in parsed).toBe(false)
  })

  // Teeth: the non-strict tolerance is load-bearing. A pod that chokes on the unknown field reds.
  it('TEETH: a STRICT v1 consumer rejects the additive field (planted incompatibility)', () => {
    const strictV1 = FlagStateChangedEventV1.strict()
    expect(() => strictV1.parse(additiveFlagPayload)).toThrow()
  })

  it('the N pod tolerates a flag_key it was never built for (a flag the old pod does not know)', () => {
    const unknownFlag = { ...additiveFlagPayload, flag_key: 'experimental-new-feature' }
    expect(() => FlagStateChangedEventV1.parse(unknownFlag)).not.toThrow()
  })
})

// --- 2. breaking coexistence: moderation v1→v2, the canonical outage ------------------------------

describe('N/N+1 breaking coexistence: moderation v1→v2 (ADR-0020, the canonical outage)', () => {
  it('the N+1 pod parses the v2 event with full fidelity (disposition + citations preserved)', () => {
    const parsed = ModerationDecisionRecordedEvent.parse(moderationV2Payload)
    expect(parsed.disposition).toBe('remove')
    expect(parsed.cited_rules).toEqual(['no-harassment'])
    expect(parsed.departs_from_precedent).toBe(false)
  })

  it('a version-NAIVE N pod CHOKES on the v2 event — the outage is real', () => {
    const naive = versionNaiveConsumer(ModerationDecisionRecordedEventV1, 1)
    expect(() => naive.handle(moderationV2Message)).toThrow()
  })

  it('a version-AWARE N pod QUARANTINES the v2 event — graceful degradation, no crash', () => {
    const aware = moderatorNPod()
    aware.handle(moderationV2Message)
    expect(aware.received).toHaveLength(0)
    expect(aware.quarantined).toHaveLength(1)
    expect(aware.quarantined[0]).toBe(moderationV2Message)
  })

  it('a version-AWARE N+1 pod retains BOTH parsers and reads in-flight v1 AND v2 without loss', () => {
    const nPlus1 = moderatorNPlus1Pod()
    const bus = coexistenceBus()
    bus.bind(nPlus1.handle)

    bus.publish(moderationV1Message)
    bus.publish(moderationV2Message)

    expect(nPlus1.received).toHaveLength(2)
    expect(nPlus1.quarantined).toHaveLength(0)
    expect(nPlus1.received.map((r) => r.eventVersion)).toEqual([1, 2])
  })

  it('one v2 event fans out to both pods at once: N+1 accepts, N quarantines, neither corrupts', () => {
    const n = moderatorNPod()
    const nPlus1 = moderatorNPlus1Pod()
    const bus = coexistenceBus()
    bus.bind(n.handle)
    bus.bind(nPlus1.handle)

    bus.publish(moderationV2Message)

    expect(nPlus1.received).toHaveLength(1)
    expect(n.received).toHaveLength(0)
    expect(n.quarantined).toHaveLength(1)
  })
})

// --- 3. deploy-then-rollback drill: state consistency (in-process proxy; cluster drill is Tier-B) --

describe('deploy-then-rollback drill: state stays consistent (in-process proxy)', () => {
  // A mixed stream a rolling update produces: lagging N producers still emit v1, upgraded N+1
  // producers emit v2. The same durable replays it both before and after a rollback.
  const stream: readonly WireMessage[] = [
    moderationV1Message,
    moderationV2Message,
    moderationV1Message,
  ]

  const replay = (consumer: Consumer): void => {
    const bus = coexistenceBus()
    bus.bind(consumer.handle)
    for (const msg of stream) bus.publish(msg)
  }

  it('before rollback, the N+1 binary (both parsers) applies every event — nothing quarantined', () => {
    const nPlus1 = moderatorNPlus1Pod()
    replay(nPlus1)
    expect(nPlus1.received).toHaveLength(stream.length)
    expect(nPlus1.quarantined).toHaveLength(0)
  })

  it('after rollback to v1, every event is cleanly applied OR cleanly quarantined — never half', () => {
    const rolledBack = moderatorNPod()
    replay(rolledBack)
    // No event is lost or half-processed: applied + quarantined accounts for the whole stream.
    expect(rolledBack.received.length + rolledBack.quarantined.length).toBe(stream.length)
    // The post-rollback binary applied exactly the v1 events and quarantined exactly the v2 ones.
    expect(rolledBack.received.map((r) => r.eventVersion)).toEqual([1, 1])
    expect(rolledBack.quarantined.map((m) => m.eventVersion)).toEqual([2])
  })

  it('every applied record re-validates against the v1 schema — no corrupted/partial state', () => {
    const rolledBack = moderatorNPod()
    replay(rolledBack)
    const applied = rolledBack.received.map((r) => ModerationDecisionRecordedEventV1.parse(r.data))
    expect(applied).toHaveLength(2)
  })
})
