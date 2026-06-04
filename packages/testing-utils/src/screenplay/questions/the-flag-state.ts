import type { Question } from '../question'
import { TESTID } from '../testids'

/** Read the rollout state the UI currently shows. Routes through `withPageProvider()`. */
export function theFlagState(): Question<string> {
  return {
    async answeredBy(actor) {
      const page = actor.withPageProvider().getPage()
      const text = await page.getByTestId(TESTID.rolloutState).textContent()
      return text?.trim() ?? ''
    },
  }
}
