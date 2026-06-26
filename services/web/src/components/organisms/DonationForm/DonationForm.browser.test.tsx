import { castDonation } from '@qaroom/testing-utils/screenplay'
import { createComponentActor } from '@qaroom/testing-utils/screenplay-ct'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { Enabled } from './DonationForm.stories'

// Second dual-context proof (ADR-0027, supersedes ADR-0005 exit criterion 5): the `castDonation` Task
// — the same source file the donation system flow uses — drives the DonationForm organism rendered by
// vitest-browser-react via the InteractWithComponent ability. `Enabled.Component` is the portable
// CSF-factory story (enabled state pre-applied); the test overrides `onDonate` to capture the amount.
// One vocabulary, two runtimes. Browser required.
test('the castDonation Task drives the DonationForm in component context', async () => {
  const donated: number[] = []
  const screen = await render(
    <Enabled.Component
      onDonate={(amountCents) => {
        donated.push(amountCents)
      }}
    />,
  )
  const actor = createComponentActor(screen, 'Dana')

  await actor.attemptsTo(castDonation(2500))
  expect(donated).toEqual([2500]) // $25.00 → exactly 2500 cents (no 100× drift)
})
