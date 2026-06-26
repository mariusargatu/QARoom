import preview from '../../../../.storybook/preview'
import { DonationAmountField } from './DonationAmountField'

// CSF Factory format (ADR-0027 §4). Molecule tier — the labelled amount input + submit composed from
// the Button atom (already proven); these stories cover only the enabled/disabled/pending states it adds.
const meta = preview.meta({
  title: 'molecules/DonationAmountField',
  component: DonationAmountField,
  args: { onSubmit: () => {} },
})

export const Enabled = meta.story({})
export const Disabled = meta.story({ args: { disabled: true } })
export const Pending = meta.story({ args: { pending: true } })
