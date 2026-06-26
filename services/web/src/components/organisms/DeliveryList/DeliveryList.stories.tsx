import { EXAMPLE_WEBHOOK_DELIVERY, WebhookDelivery } from '@qaroom/contracts'
import preview from '../../../../.storybook/preview'
import { DeliveryList } from './DeliveryList'

// CSF Factory format (ADR-0027 §4). Organism tier — the delivered/loading/empty states of the
// webhook delivery ledger; the Badge and Skeleton atoms inside are already proven, so these stories
// test only the list's own composition (delivery rows + the loading/empty fallbacks).
const meta = preview.meta({
  title: 'organisms/DeliveryList',
  component: DeliveryList,
  args: { deliveries: [WebhookDelivery.parse(EXAMPLE_WEBHOOK_DELIVERY)] },
})

export const Delivered = meta.story({})
export const Loading = meta.story({ args: { loading: true, deliveries: [] } })
export const Empty = meta.story({ args: { deliveries: [] } })
