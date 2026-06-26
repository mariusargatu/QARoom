import { LOC, locateTestId } from '../locators'
import type { UiHandle } from '../page-provider'
import type { Task } from '../task'

/**
 * Click the atom under test. Routes through `withPageProvider()` (never a concrete ability), so the
 * SAME Task drives the broken-atom component test (mounted Button) and could drive an E2E page
 * unchanged (ADR-0005, narrowed by ADR-0027).
 */
export function clickTheButton(): Task {
  return {
    async performAs(actor) {
      const ui = actor.withPageProvider().getDriver()
      await locateTestId<UiHandle>(ui, LOC.button.under).click()
    },
  }
}
