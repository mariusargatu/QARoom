import type { Task } from '../task'
import { TESTID } from '../testids'

/**
 * Donate `amountCents` and submit. Routes through `withPageProvider()`. The amount field is in
 * DOLLARS (DonationAmountField emits cents via `*100`), so cents are converted on the way in — the
 * Task speaks the domain's cents, the field speaks dollars.
 */
export function castDonation(amountCents: number): Task {
  return {
    async performAs(actor) {
      const page = actor.withPageProvider().getPage()
      await page.getByTestId(TESTID.donationAmount).fill(String(amountCents / 100))
      await page.getByTestId(TESTID.donationSubmit).click()
    },
  }
}
