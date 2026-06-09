import { EXAMPLE_WEBHOOK_SUBSCRIPTION, WebhookSubscription } from '@qaroom/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { WebhookList } from './WebhookList'

const noop = () => {}
const active = WebhookSubscription.parse(EXAMPLE_WEBHOOK_SUBSCRIPTION)
const paused = WebhookSubscription.parse({ ...EXAMPLE_WEBHOOK_SUBSCRIPTION, status: 'Paused' })

const meta = {
  title: 'organisms/WebhookList',
  component: WebhookList,
  args: {
    webhooks: [active],
    onPause: noop,
    onResume: noop,
    onDelete: noop,
    onViewDeliveries: noop,
  },
} satisfies Meta<typeof WebhookList>

export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = {}
export const Paused: Story = { args: { webhooks: [paused] } }
export const Empty: Story = { args: { webhooks: [] } }
