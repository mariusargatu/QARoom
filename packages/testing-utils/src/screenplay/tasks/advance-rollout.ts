import type { Task } from '../task'
import { TESTID } from '../testids'

/**
 * Click the control that requests a rollout-advancing event. Routes through
 * `withPageProvider()` (never `BrowseTheWeb` directly), so the same Task runs as an E2E test
 * (real page) and a Milestone-8 component test (mounted organism) unchanged.
 */
export function advanceRollout(event: string): Task {
  return {
    async performAs(actor) {
      const page = actor.withPageProvider().getPage()
      await page.getByTestId(TESTID.rolloutAdvance(event)).click()
    },
  }
}
