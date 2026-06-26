import { LOC, locateTestId } from '../locators'
import type { UiHandle } from '../page-provider'
import type { Task } from '../task'

/**
 * Donate `amountCents` and submit. Routes through `withPageProvider()`. The amount field is in
 * DOLLARS (DonationAmountField emits cents via `*100`), so cents are converted on the way in — the
 * Task speaks the domain's cents, the field speaks dollars.
 */
export function castDonation(amountCents: number): Task {
  return {
    async performAs(actor) {
      const ui = actor.withPageProvider().getDriver()
      await locateTestId<UiHandle>(ui, LOC.donation.amount).fill(String(amountCents / 100))
      await locateTestId<UiHandle>(ui, LOC.donation.submit).click()
    },
  }
}
