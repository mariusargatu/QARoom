import { LOC, locateTestId } from '../locators'
import type { UiHandle } from '../page-provider'
import type { Task } from '../task'

/**
 * Click the control that requests a rollout-advancing event. Routes through
 * `withPageProvider()` (never `BrowseTheWeb` directly), so the same Task runs as an E2E test
 * (real page) and a component test (mounted organism) unchanged (ADR-0027).
 */
export function advanceRollout(event: string): Task {
  return {
    async performAs(actor) {
      const ui = actor.withPageProvider().getDriver()
      await locateTestId<UiHandle>(ui, LOC.rollout.advance(event)).click()
    },
  }
}
