import type { Task } from '../task'
import { TESTID } from '../testids'

/**
 * Click the atom under test. Routes through `withPageProvider()` (never a concrete ability), so the
 * SAME Task drives the Milestone-8 broken-atom component test (mounted Button) and could drive an
 * E2E page unchanged (ADR-0005).
 */
export function clickTheButton(): Task {
  return {
    async performAs(actor) {
      const page = actor.withPageProvider().getPage()
      await page.getByTestId(TESTID.buttonUnderTest).click()
    },
  }
}
