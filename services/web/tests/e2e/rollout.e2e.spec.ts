import { expect, test } from '@playwright/test'
import { rolloutMachine } from '@qaroom/contracts'
import { shortestPaths } from '@qaroom/testing-utils/mbt'
import { Actor, advanceRollout, BrowseTheWeb, theFlagState } from '@qaroom/testing-utils/screenplay'

/**
 * Model-based E2E (ADR-0005, the Milestone-5 headline). Every shortest path through the rollout
 * model becomes a Screenplay flow run against the live web app: the actor advances the rollout
 * by each modeled event and the UI must report exactly the state the model predicts. The SAME
 * Tasks/Questions (`advanceRollout` / `theFlagState`) drive the Milestone-8 component test —
 * proving one Screenplay vocabulary across both contexts; only the ability binding differs
 * (BrowseTheWeb here, InteractWithComponent in CT). Requires the live stack.
 */
const paths = shortestPaths(rolloutMachine, { maxDepth: 10 }).filter((p) => p.steps.length > 0)

for (const path of paths) {
  test(`rollout path: ${path.description}`, async ({ page }) => {
    await page.goto('/')
    const actor = Actor.named('Dana').can(BrowseTheWeb.using(page))
    for (const step of path.steps) {
      await actor.attemptsTo(advanceRollout(step.event))
      await expect.poll(() => actor.asks(theFlagState())).toBe(JSON.parse(step.state) as string)
    }
  })
}
