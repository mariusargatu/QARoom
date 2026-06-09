import { expect, test } from '@playwright/test'
import { rolloutMachine } from '@qaroom/contracts'
import { shortestPaths } from '@qaroom/testing-utils/mbt'
import { Actor, advanceRollout, BrowseTheWeb, theFlagState } from '@qaroom/testing-utils/screenplay'

/**
 * Model-based E2E (ADR-0005, the Milestone-5 headline). Every shortest path through the rollout
 * model becomes a Screenplay flow run against the live web app: the actor advances the rollout by
 * each modeled event and the UI must report exactly the state the model predicts. The SAME
 * Tasks/Questions (`advanceRollout` / `theFlagState`) drive the Milestone-8 component test —
 * proving one Screenplay vocabulary across both contexts; only the ability binding differs
 * (BrowseTheWeb here, InteractWithComponent in CT). Requires the live stack.
 *
 * Milestone-14 routing change: the app now gates on a session (ADR-0022) and the donations-rollout
 * control lives on a community's Flags screen. Each path runs against its OWN fresh community
 * (created via the gateway) so every path starts from the model's initial state (`Off`) with no
 * cross-path shared state — the only honest way to replay independent model paths. The gateway REST
 * plane is unauthenticated by design, so a seeded localStorage token unlocks the routed UI.
 */
const paths = shortestPaths(rolloutMachine, { maxDepth: 10 }).filter((p) => p.steps.length > 0)

// `process.pid` keeps slugs unique across runs (communities persist in the cluster) without a
// clock/RNG — the determinism stance holds even in test setup.
const runId = process.pid
let counter = 0

for (const path of paths) {
  test(`rollout path: ${path.description}`, async ({ page }) => {
    counter += 1
    const slug = `e2e_rollout_${runId}_${counter}`
    // Create the community FROM THE BROWSER: Node's resolver doesn't map `*.localhost` (RFC 6761)
    // but Chromium does, and this keeps the call same-origin with the gateway behind the ingress.
    await page.goto('/login')
    const communityId = await page.evaluate(async (communitySlug: string): Promise<string> => {
      const res = await fetch('/api/communities', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `idem-${communitySlug}` },
        body: JSON.stringify({ slug: communitySlug, name: communitySlug }),
      })
      // eslint-disable-next-line qaroom/no-conditional-in-test -- fetch-failure guard in browser-injected glue (page.evaluate), not assertion branching
      if (!res.ok) throw new Error(`createCommunity → ${res.status}`)
      return ((await res.json()) as { id: string }).id
    }, slug)
    await page.addInitScript((cid: string) => {
      localStorage.setItem(
        'qaroom.session',
        JSON.stringify({
          token: 'e2e.demo.token',
          currentUser: {
            id: 'user_00000000000000000000000000',
            handle: 'e2e',
            display_name: 'E2E',
          },
        }),
      )
      localStorage.setItem(
        'qaroom.communities',
        JSON.stringify([{ id: cid, slug: 'e2e', name: 'E2E' }]),
      )
    }, communityId)
    await page.goto(`/c/${communityId}/flags`)
    const actor = Actor.named('Dana').can(BrowseTheWeb.using(page))
    for (const step of path.steps) {
      await actor.attemptsTo(advanceRollout(step.event))
      await expect.poll(() => actor.asks(theFlagState())).toBe(JSON.parse(step.state) as string)
    }
  })
}
