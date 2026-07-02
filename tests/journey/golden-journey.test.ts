import { type PortForward, portForward } from '@qaroom/testing-utils/chaos'
import { GatewayClient } from '@qaroom/testing-utils/live-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { problemDetailsVerdict, tenantSpansVerdict } from './lib/commitments'

/**
 * The golden journey (the live end-to-end falsification harness).
 *
 * One user walks the WHOLE platform through the gateway, on the real cluster:
 *
 *   createUser -> createSession -> createCommunity -> addMembership -> createPost -> castVote
 *     -> readFeed -> createDonation -> createWebhook -> (delivery lands) -> (moderation lands)
 *
 * Every step touches a different service; together they exercise NATS fan-out (webhook
 * delivery, moderation disposition) and the cross-service trace. The journey then asserts the
 * architecture's COMMITMENTS on the traffic it just produced — not in a mock, against the real
 * distributed system:
 *
 *   - Commitment 9 (tenant.id on every span) via `tenantSpansVerdict` against live Jaeger.
 *   - RFC 7807 on a deliberately-provoked non-2xx via `problemDetailsVerdict`.
 *
 * WHY this exists (see docs/02-architecture.md + the detection matrix Tier B): the existing
 * proofs run in-process or as a gauntlet epilogue. This makes the invariants first-class,
 * self-contained, reproducible cluster assertions. It is the seam the deliberate-bug toggles
 * arm against: run with `CHAOS_TENANT_SPAN_DROP=1` on the services and the tenant-span verdict
 * goes red — the in-process detector, now proven live.
 *
 * Runs only via `pnpm journey:run` (live k3d + Jaeger), never in `pnpm test`. Bring the cluster
 * up first (`pnpm dev`). Tunables via env:
 *   JOURNEY_RUN_ID         unique suffix for handle/slug so re-runs don't collide (default: now)
 *   JOURNEY_JAEGER_LOOKBACK  Jaeger window for the span commitment (default 5m)
 */
const RUN_ID = process.env.JOURNEY_RUN_ID ?? `r${Date.now().toString(36)}`
const REQUEST_BUDGET_MS = 15_000
const JOURNEY_SERVICES = ['gateway', 'content', 'identity', 'flags', 'donations', 'webhooks']
const JAEGER_LOOKBACK = process.env.JOURNEY_JAEGER_LOOKBACK ?? '5m'
/** Poll budget for the async NATS-driven effects (webhook delivery, moderation disposition). */
const POLL = { withinMs: 30_000, everyMs: 1_000 } as const

let gateway: PortForward
let jaeger: PortForward
let client: GatewayClient

beforeAll(async () => {
  gateway = await portForward({
    namespace: 'qaroom',
    target: 'svc/gateway',
    localPort: 18080,
    remotePort: 80,
  })
  jaeger = await portForward({
    namespace: 'observability',
    target: 'svc/qaroom-jaeger',
    localPort: 16686,
    remotePort: 16686,
  })
  client = new GatewayClient({
    baseUrl: gateway.url,
    requestBudgetMs: REQUEST_BUDGET_MS,
    idempotencySeed: `journey-${RUN_ID}`,
  })
}, 120_000)

afterAll(() => {
  gateway?.stop()
  jaeger?.stop()
})

/** Read `.id` off a JSON response body without conditionals leaking into the test. */
function idOf(body: unknown): string {
  return String((body as { id?: unknown })?.id ?? '')
}
function tokenOf(body: unknown): string {
  return String((body as { access_token?: unknown })?.access_token ?? '')
}
function feedHasPost(body: unknown, postId: string): boolean {
  const posts = (body as { posts?: ReadonlyArray<{ id?: unknown }> })?.posts ?? []
  return posts.some((p) => String(p.id) === postId)
}
/** True when the named array property of a list envelope is non-empty. The list endpoints use
 * distinct keys per resource (Feed.posts, WebhookDeliveryList.deliveries, ModerationDecisionList.decisions). */
function nonEmptyAt(body: unknown, key: string): boolean {
  const list = (body as Record<string, unknown> | null)?.[key]
  return Array.isArray(list) && list.length > 0
}

describe('golden journey: one user, the whole platform, live', () => {
  it('walks every service and holds the commitments on the traffic it produced', async () => {
    // 1. identity: a user.
    const user = await client.post('/api/users', {
      handle: `ada_${RUN_ID}`,
      display_name: 'Ada Lovelace',
    })
    expect(user.status, JSON.stringify(user.body)).toBe(201)
    const userId = idOf(user.body)

    // 2. identity: a session -> bearer token carried by every later call.
    const session = await client.post('/api/sessions', { user_id: userId })
    expect(session.status, JSON.stringify(session.body)).toBe(201)
    const token = tokenOf(session.body)
    expect(token.length).toBeGreaterThan(0)

    // 3. identity: a community (the tenant).
    const community = await client.post(
      '/api/communities',
      { slug: `journey_${RUN_ID}`, name: `Journey ${RUN_ID}` },
      { token },
    )
    expect(community.status, JSON.stringify(community.body)).toBe(201)
    const communityId = idOf(community.body)

    // 4. identity: membership.
    const membership = await client.post(
      `/api/communities/${communityId}/members`,
      { user_id: userId, role: 'member' },
      { token },
    )
    expect([200, 201]).toContain(membership.status)

    // 5. content: a post.
    const post = await client.post(
      `/api/communities/${communityId}/posts`,
      {
        author_id: userId,
        title: 'Why deterministic clocks matter',
        body: 'A short note on testability.',
      },
      { token },
    )
    expect(post.status, JSON.stringify(post.body)).toBe(201)
    const postId = idOf(post.body)

    // 6. content: a vote.
    const vote = await client.post(
      `/api/posts/${postId}/votes`,
      { voter_id: userId, value: 1 },
      { token },
    )
    expect([200, 201]).toContain(vote.status)

    // 7. content: the post is visible in the community feed.
    const feed = await client.get(`/api/communities/${communityId}/feed`, { token })
    expect(feed.status).toBe(200)
    expect(feedHasPost(feed.body, postId), JSON.stringify(feed.body)).toBe(true)

    // 8a. flags: open the donations gate for THIS community first. The flag is per-community and
    // opt-in (default Off); only the `Enabled` rollout state opens it, and donations-service learns
    // of the change ASYNCHRONOUSLY via a NATS flag-state event. So drive the rollout Off→Enabling→
    // Canary→Enabled, then poll until the gate has propagated (flags→NATS→donations) before donating.
    for (const event of ['EnableRequested', 'CanaryConfirmed', 'RolloutCompleted'] as const) {
      const advance = await client.post(
        `/api/communities/${communityId}/flags/donations/rollout`,
        { event },
        { token },
      )
      expect([200, 201], JSON.stringify(advance.body)).toContain(advance.status)
    }
    // 8b. donations: a donation (crosses the flags gate + Microcks-mocked provider). The gate lives
    // in donations-service's LOCAL flag cache, fed by the NATS flag-state event — so the flags-service
    // reporting `enabled` does NOT mean donations saw it yet. Poll the write itself until the gate has
    // propagated (retry a 409 `gated`); a persistent non-2xx (e.g. a 502 payment fault) still fails.
    const donation = await client.pollPostUntil(
      `/api/communities/${communityId}/donations`,
      { donor_id: userId, amount_cents: 500, currency: 'USD' },
      (r) => r.status === 201 || r.status === 202,
      { token, ...POLL },
    )
    expect([201, 202], JSON.stringify(donation.body)).toContain(donation.status)

    // 9. webhooks: a subscription, then an at-least-once delivery must land (NATS fan-out).
    const subscription = await client.post(
      `/api/communities/${communityId}/webhook-subscriptions`,
      { url: 'https://hooks.example.com/qaroom', event_types: ['post.created'] },
      { token },
    )
    expect(subscription.status, JSON.stringify(subscription.body)).toBe(201)
    const subscriptionId = idOf(subscription.body)

    // 9b. content: a post AFTER subscribing. Webhooks is event-driven (at-least-once to subscribers
    // active AT event time) — the step-5 post.created fired before any subscriber existed, so it never
    // fans out here. This post is the event that reaches the new subscription (and the moderator).
    const watchedPost = await client.post(
      `/api/communities/${communityId}/posts`,
      {
        author_id: userId,
        title: 'Second post, now with a webhook watching',
        body: 'Trigger the fan-out.',
      },
      { token },
    )
    expect(watchedPost.status, JSON.stringify(watchedPost.body)).toBe(201)

    // 10. The webhook delivery and the moderation disposition are independent async NATS fan-outs
    // from the post just produced — poll for both concurrently rather than 30s + 30s in series.
    const [deliveries, moderation] = await Promise.all([
      client.pollUntil(
        `/api/communities/${communityId}/webhook-subscriptions/${subscriptionId}/deliveries`,
        (r) => r.status === 200 && nonEmptyAt(r.body, 'deliveries'),
        { token, ...POLL },
      ),
      client.pollUntil(
        `/api/communities/${communityId}/moderation-decisions`,
        (r) => r.status === 200 && nonEmptyAt(r.body, 'decisions'),
        { token, ...POLL },
      ),
    ])
    expect(nonEmptyAt(deliveries.body, 'deliveries'), JSON.stringify(deliveries.body)).toBe(true)
    expect(nonEmptyAt(moderation.body, 'decisions'), JSON.stringify(moderation.body)).toBe(true)

    // COMMITMENT — Commitment 9, live: every span this journey produced carries tenant.id.
    const spans = await tenantSpansVerdict({
      jaegerUrl: jaeger.url,
      services: JOURNEY_SERVICES,
      lookback: JAEGER_LOOKBACK,
      limitPerService: 50,
    })
    expect(spans.ok, spans.detail).toBe(true)
  })

  it('returns an RFC 7807 problem (not a naked error) on a missing resource', async () => {
    const missing = await client.get('/api/posts/post_00000000000000000000000000')
    expect(missing.status).toBeGreaterThanOrEqual(400)
    const verdict = problemDetailsVerdict(missing)
    expect(verdict.ok, verdict.detail).toBe(true)
  })
})
