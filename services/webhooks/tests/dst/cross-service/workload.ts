import { EXAMPLE_COMMUNITY_ID, EXAMPLE_USER_ID, type WebhookEventType } from '@qaroom/contracts'
import type { SeededRandomness } from '@qaroom/testing-utils/determinism'
import type { EndpointProfile } from '../types'

/**
 * The seeded WORKLOAD GENERATOR (DST component 5) for the composed run: the set of external
 * subscriptions to register on webhooks, and the sequence of content mutations (create post / cast
 * vote) to drive through content's real HTTP surface. Everything is a pure function of one seed, so
 * two worlds from the same seed register the same endpoints and replay the same calls — the
 * precondition for the byte-identical composed meta-test.
 */

/** The two communities events and subscriptions partition across (the tenancy boundary). */
export const SAMPLE = {
  communityA: EXAMPLE_COMMUNITY_ID,
  communityB: 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE',
} as const

/** The five domain event types — every subscription listens to all of them (max fan-out). */
const ALL_EVENT_TYPES: WebhookEventType[] = [
  'post.created',
  'vote.cast',
  'flag.state.changed',
  'donation.state.changed',
  'moderation.decision.recorded',
]

/** The seeded shape of one subscription to register on webhooks. */
export interface SubscriptionSpec {
  communityId: string
  url: string
  profile: EndpointProfile
  eventTypes: WebhookEventType[]
}

/** Create a post in `communityId` — emits a `post.created` content event onto the bus. */
export interface PostAction {
  kind: 'post'
  communityId: string
  idemKey: string
  title: string
  body: string
}

/** Cast a vote on an earlier-created post (by workload index) — emits a `vote.cast` event. */
export interface VoteAction {
  kind: 'vote'
  postIndex: number
  idemKey: string
  voterId: string
  value: 1 | -1
}

export type WorkloadAction = PostAction | VoteAction

/** The seed-derived shape of one composed world. */
export interface ComposedConfig {
  seed: number
  communities: readonly string[]
  subscriptionCount: number
  postCount: number
  voteCount: number
}

/** Derive a world's size from its seed: a couple of subscriptions, a handful of posts, a few votes. */
export function defaultConfig(seed: number): ComposedConfig {
  return {
    seed,
    communities: [SAMPLE.communityA, SAMPLE.communityB],
    subscriptionCount: 2 + (seed % 2), // 2..3
    postCount: 3 + (seed % 3), // 3..5
    voteCount: 1 + (seed % 2), // 1..2
  }
}

/**
 * Seed the subscriptions. A floor guarantees both terminal outcomes always occur AND the planted-bug
 * demo is robust: index 0 is a `down` endpoint and index 1 a `healthy` one, both in communityA — so
 * communityA always has an active subscription (every post there is "notifying"), the down endpoint
 * always dead-letters, and the healthy one always delivers. The rest are seeded across communities.
 */
export function generateSubscriptionSpecs(
  gen: SeededRandomness,
  config: ComposedConfig,
): SubscriptionSpec[] {
  const profiles: EndpointProfile[] = ['healthy', 'flaky', 'slow', 'down']
  const specs: SubscriptionSpec[] = []
  for (let i = 0; i < config.subscriptionCount; i += 1) {
    const profile = i === 0 ? 'down' : i === 1 ? 'healthy' : pick(gen, profiles)
    const communityId = i < 2 ? SAMPLE.communityA : pick(gen, config.communities)
    specs.push({
      communityId,
      url: `https://hooks.example.test/sub-${i}`,
      profile,
      eventTypes: [...ALL_EVENT_TYPES],
    })
  }
  return specs
}

/**
 * Seed the content workload: `postCount` create-post calls (the FIRST pinned to communityA, so it is
 * always notifying — and so the planted drop, which lands on the first `post.created`, always hits a
 * notifying event), then `voteCount` votes on the earliest posts (cross-channel coverage).
 */
export function generateWorkload(gen: SeededRandomness, config: ComposedConfig): WorkloadAction[] {
  const actions: WorkloadAction[] = []
  for (let i = 0; i < config.postCount; i += 1) {
    const communityId = i === 0 ? SAMPLE.communityA : pick(gen, config.communities)
    actions.push({
      kind: 'post',
      communityId,
      idemKey: `post-${config.seed}-${i}`,
      title: `post ${i}`,
      body: `body for post ${i} in seed ${config.seed}`,
    })
  }
  const votablePosts = Math.min(config.voteCount, config.postCount)
  for (let i = 0; i < votablePosts; i += 1) {
    actions.push({
      kind: 'vote',
      postIndex: i,
      idemKey: `vote-${config.seed}-${i}`,
      voterId: EXAMPLE_USER_ID,
      value: gen.next() < 0.5 ? 1 : -1,
    })
  }
  return actions
}

function pick<T>(gen: SeededRandomness, items: readonly T[]): T {
  const value = items[gen.int(0, items.length - 1)]
  if (value === undefined) throw new Error('pick: cannot choose from an empty array')
  return value
}
