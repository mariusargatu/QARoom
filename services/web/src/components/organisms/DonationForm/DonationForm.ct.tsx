import { castDonation } from '@qaroom/testing-utils/screenplay'
import { createComponentActor } from '@qaroom/testing-utils/screenplay-ct'
import { composeStories } from '@storybook/react-vite'
import { expect, test } from '../../../../playwright'
import { readyFonts } from '../../../test-support/ready-fonts'
import { DonationForm, type DonationFormProps } from './DonationForm'
import * as stories from './DonationForm.stories'

// Second dual-context proof (ADR-0005, exit criterion 5): the `castDonation` Task — the same source
// file the donation system flow uses — drives the mounted DonationForm organism here via the
// InteractWithComponent ability. Args are READ via composeStories; the CT mounts the RAW component
// spread. One vocabulary, two runtimes. Browser required.
const { Enabled } = composeStories(stories)

test('the castDonation Task drives the DonationForm in component context', async ({ mount }) => {
  const donated: number[] = []
  const args: DonationFormProps = {
    ...(Enabled.args as DonationFormProps),
    enabled: true,
    onDonate: (amountCents) => donated.push(amountCents),
  }
  const mounted = await readyFonts(await mount(<DonationForm {...args} />))
  const actor = createComponentActor(mounted, 'Dana')

  await actor.attemptsTo(castDonation(2500))
  expect(donated).toEqual([2500]) // $25.00 → exactly 2500 cents (no 100× drift)
})
