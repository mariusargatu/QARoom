import { EXAMPLE_WEBHOOK_DELIVERY, WebhookDelivery } from '@qaroom/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { DeliveryList } from './DeliveryList'

const meta = {
  title: 'organisms/DeliveryList',
  component: DeliveryList,
  args: { deliveries: [WebhookDelivery.parse(EXAMPLE_WEBHOOK_DELIVERY)] },
} satisfies Meta<typeof DeliveryList>

export default meta
type Story = StoryObj<typeof meta>

export const Delivered: Story = {}
export const Loading: Story = { args: { loading: true, deliveries: [] } }
export const Empty: Story = { args: { deliveries: [] } }
