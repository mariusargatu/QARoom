import type { Meta, StoryObj } from '@storybook/react-vite'
import { RolloutPanel } from './RolloutPanel'

const meta = {
  title: 'organisms/RolloutPanel',
  component: RolloutPanel,
  args: { onAdvance: () => {} },
} satisfies Meta<typeof RolloutPanel>

export default meta
type Story = StoryObj<typeof meta>

export const OffState: Story = { args: { state: 'Off', legalEvents: ['EnableRequested'] } }
export const Canary: Story = {
  args: { state: 'Canary', legalEvents: ['RolloutCompleted', 'RolloutAborted'] },
}
export const Enabled: Story = { args: { state: 'Enabled', legalEvents: ['DisableRequested'] } }
export const Loading: Story = { args: { state: 'Off', legalEvents: [], loading: true } }
