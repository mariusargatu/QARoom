import { LOC, locateTestId } from '../locators'
import type { UiHandle } from '../page-provider'
import type { Question } from '../question'

/** Read the rollout state the UI currently shows. Routes through `withPageProvider()`. */
export function theFlagState(): Question<string> {
  return {
    async answeredBy(actor) {
      const ui = actor.withPageProvider().getDriver()
      const text = await locateTestId<UiHandle>(ui, LOC.rollout.state).textContent()
      return text?.trim() ?? ''
    },
  }
}
