import type { Task } from '../task'
import { TESTID } from '../testids'

/** Fill the donation amount (in cents) and submit. Routes through `withPageProvider()`. */
export function castDonation(amountCents: number): Task {
  return {
    async performAs(actor) {
      const page = actor.withPageProvider().getPage()
      await page.getByTestId(TESTID.donationAmount).fill(String(amountCents))
      await page.getByTestId(TESTID.donationSubmit).click()
    },
  }
}
