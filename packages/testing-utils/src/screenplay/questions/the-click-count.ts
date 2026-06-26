import { LOC, locateTestId } from '../locators'
import type { UiHandle } from '../page-provider'
import type { Question } from '../question'

/**
 * How many times the atom under test has dispatched its click, read from the visible counter.
 * Routes through `withPageProvider()`. The broken-atom demo (ADR-0005) breaks Button so its onClick
 * never reaches the DOM; this Question then stays 0 and the asserting test fails.
 */
export function theClickCount(): Question<number> {
  return {
    async answeredBy(actor) {
      const ui = actor.withPageProvider().getDriver()
      const text = await locateTestId<UiHandle>(ui, LOC.button.count).textContent()
      return Number(text?.trim() ?? '0')
    },
  }
}
