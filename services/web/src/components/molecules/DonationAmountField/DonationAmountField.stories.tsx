import type { Meta, StoryObj } from '@storybook/react-vite'
import { DonationAmountField } from './DonationAmountField'

const meta = {
  title: 'molecules/DonationAmountField',
  component: DonationAmountField,
  args: { onSubmit: () => {} },
} satisfies Meta<typeof DonationAmountField>

export default meta
type Story = StoryObj<typeof meta>

export const Enabled: Story = {}
export const Disabled: Story = { args: { disabled: true } }
export const Pending: Story = { args: { pending: true } }
