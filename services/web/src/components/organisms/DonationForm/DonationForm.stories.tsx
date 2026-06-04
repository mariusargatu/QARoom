import type { Meta, StoryObj } from '@storybook/react-vite'
import { DonationForm } from './DonationForm'

const meta = {
  title: 'organisms/DonationForm',
  component: DonationForm,
  args: { onDonate: () => {} },
} satisfies Meta<typeof DonationForm>

export default meta
type Story = StoryObj<typeof meta>

export const Enabled: Story = { args: { enabled: true } }
export const Gated: Story = { args: { enabled: false } }
export const Pending: Story = { args: { enabled: true, pending: true } }
