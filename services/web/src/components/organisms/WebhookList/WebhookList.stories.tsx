import { EXAMPLE_WEBHOOK_SUBSCRIPTION, WebhookSubscription } from '@qaroom/contracts'
import preview from '../../../../.storybook/preview'
import { WebhookList } from './WebhookList'

const noop = () => {}
const active = WebhookSubscription.parse(EXAMPLE_WEBHOOK_SUBSCRIPTION)
const paused = WebhookSubscription.parse({ ...EXAMPLE_WEBHOOK_SUBSCRIPTION, status: 'Paused' })

// CSF Factory format (ADR-0027 §4). Organism tier — the active/paused/empty states of the webhook
// subscriptions table; the Badge/Button/Skeleton atoms inside are already proven, so these stories
// test only the list's own composition (one row per subscription + its pause/resume/delete actions).
const meta = preview.meta({
  title: 'organisms/WebhookList',
  component: WebhookList,
  args: {
    webhooks: [active],
    onPause: noop,
    onResume: noop,
    onDelete: noop,
    onViewDeliveries: noop,
  },
})

export const Active = meta.story({})
export const Paused = meta.story({ args: { webhooks: [paused] } })
export const Empty = meta.story({ args: { webhooks: [] } })
