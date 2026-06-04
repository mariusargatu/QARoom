import type { Question } from '../question'
import { TESTID } from '../testids'

/**
 * How many times the atom under test has dispatched its click, read from the visible counter.
 * Routes through `withPageProvider()`. The broken-atom demo (ADR-0005) breaks Button so its onClick
 * never reaches the DOM; this Question then stays 0 and the asserting test fails.
 */
export function theClickCount(): Question<number> {
  return {
    async answeredBy(actor) {
      const page = actor.withPageProvider().getPage()
      const text = await page.getByTestId(TESTID.buttonClickCount).textContent()
      return Number(text?.trim() ?? '0')
    },
  }
}
