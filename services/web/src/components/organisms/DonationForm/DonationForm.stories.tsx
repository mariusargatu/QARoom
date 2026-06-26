import preview from '../../../../.storybook/preview'
import { DonationForm } from './DonationForm'

// CSF Factory format (ADR-0027 §4). Organism tier — gated/enabled/pending states of the donation
// section; the DonationAmountField molecule inside is already proven. `Enabled` is reused as a
// portable story by DonationForm.browser.test.tsx.
const meta = preview.meta({
  title: 'organisms/DonationForm',
  component: DonationForm,
  args: { onDonate: () => {} },
})

export const Enabled = meta.story({ args: { enabled: true } })
export const Gated = meta.story({ args: { enabled: false } })
export const Pending = meta.story({ args: { enabled: true, pending: true } })
