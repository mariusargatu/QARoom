/// <reference types="@vitest/browser/matchers" />
import {
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_WEBHOOK_SUBSCRIPTION,
  EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
  EXAMPLE_WEBHOOK_URL,
  type WebhookDeliveryList,
  type WebhookSubscription,
  type WebhookSubscriptionList,
  type WebhookSubscriptionWithSecret,
} from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../../../api/client'
import { withProviders } from '../../../test-support/with-providers'
import { WebhooksPage } from './WebhooksPage'

// Page composition-delta test (ADR-0027): WebhooksPage composes the proven WebhookForm / WebhookList /
// DeliveryList organisms + useWebhooks. Its own delta is the orchestration the page adds over them:
// the load (list vs error branch), the write-once signing-secret banner that surfaces after a create,
// and opening/closing the deliveries ledger. The organisms' internals are not re-asserted.

const PATH = '/c/comm_test/webhooks'

const oneSub = {
  community_id: EXAMPLE_COMMUNITY_ID,
  webhooks: [EXAMPLE_WEBHOOK_SUBSCRIPTION],
} as unknown as WebhookSubscriptionList
const noSubs = {
  community_id: EXAMPLE_COMMUNITY_ID,
  webhooks: [],
} as unknown as WebhookSubscriptionList
const pausedSub = {
  community_id: EXAMPLE_COMMUNITY_ID,
  webhooks: [{ ...EXAMPLE_WEBHOOK_SUBSCRIPTION, status: 'Paused' }],
} as unknown as WebhookSubscriptionList

const routed = (api: Partial<ApiClient>) =>
  withProviders(
    <Routes>
      <Route path="/c/:communityId/webhooks" element={<WebhooksPage />} />
    </Routes>,
    { api, path: PATH },
  )

test('the loaded subscriptions are wired into the list', async () => {
  const screen = await render(routed({ listWebhooks: async () => oneSub }))

  await expect.element(screen.getByText(EXAMPLE_WEBHOOK_URL)).toBeVisible()
})

test('a failed load shows the retryable error state instead of the list', async () => {
  const screen = await render(
    routed({
      listWebhooks: async () => {
        throw new Error('webhooks down')
      },
    }),
  )

  await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect.element(screen.getByText('webhooks down')).toBeVisible()
})

test('registering a webhook reveals the write-once signing secret', async () => {
  const createWebhook = vi.fn(
    async () =>
      ({
        ...EXAMPLE_WEBHOOK_SUBSCRIPTION,
        secret: 'whsec_topsecret',
      }) as unknown as WebhookSubscriptionWithSecret,
  )
  const screen = await render(routed({ listWebhooks: async () => noSubs, createWebhook }))

  await screen.getByPlaceholder(EXAMPLE_WEBHOOK_URL).fill(EXAMPLE_WEBHOOK_URL)
  await screen.getByRole('checkbox', { name: 'post.created' }).click()
  await screen.getByRole('button', { name: 'Register webhook' }).click()

  await expect.element(screen.getByText('whsec_topsecret')).toBeVisible()
  expect(createWebhook).toHaveBeenCalledWith('comm_test', {
    url: EXAMPLE_WEBHOOK_URL,
    event_types: ['post.created'],
  })
})

test('viewing a subscription opens the deliveries ledger and Close dismisses it', async () => {
  const listWebhookDeliveries = vi.fn(
    async () =>
      ({
        subscription_id: EXAMPLE_WEBHOOK_SUBSCRIPTION_ID,
        deliveries: [],
      }) as unknown as WebhookDeliveryList,
  )
  const screen = await render(routed({ listWebhooks: async () => oneSub, listWebhookDeliveries }))

  await screen.getByRole('button', { name: 'Deliveries' }).click()
  await expect.element(screen.getByRole('heading', { name: 'Deliveries' })).toBeVisible()

  await screen.getByRole('button', { name: 'Close' }).click()
  await expect.element(screen.getByRole('heading', { name: 'Deliveries' })).not.toBeInTheDocument()
})

test('pausing an active subscription drives the pause action with its id', async () => {
  const pauseWebhook = vi.fn(
    async () => EXAMPLE_WEBHOOK_SUBSCRIPTION as unknown as WebhookSubscription,
  )
  const screen = await render(routed({ listWebhooks: async () => oneSub, pauseWebhook }))

  await screen.getByRole('button', { name: 'Pause' }).click()

  await vi.waitFor(() =>
    expect(pauseWebhook).toHaveBeenCalledWith('comm_test', EXAMPLE_WEBHOOK_SUBSCRIPTION_ID),
  )
})

test('resuming a paused subscription drives the resume action with its id', async () => {
  const resumeWebhook = vi.fn(
    async () => EXAMPLE_WEBHOOK_SUBSCRIPTION as unknown as WebhookSubscription,
  )
  const screen = await render(routed({ listWebhooks: async () => pausedSub, resumeWebhook }))

  await screen.getByRole('button', { name: 'Resume' }).click()

  await vi.waitFor(() =>
    expect(resumeWebhook).toHaveBeenCalledWith('comm_test', EXAMPLE_WEBHOOK_SUBSCRIPTION_ID),
  )
})

test('deleting a subscription drives the delete action with its id', async () => {
  const deleteWebhook = vi.fn(async () => {})
  const screen = await render(routed({ listWebhooks: async () => oneSub, deleteWebhook }))

  await screen.getByRole('button', { name: 'Delete' }).click()

  await vi.waitFor(() =>
    expect(deleteWebhook).toHaveBeenCalledWith('comm_test', EXAMPLE_WEBHOOK_SUBSCRIPTION_ID),
  )
})

test('a failed lifecycle action surfaces the action error alert', async () => {
  const pauseWebhook = vi.fn(async () => {
    throw new Error('pause rejected')
  })
  const screen = await render(routed({ listWebhooks: async () => oneSub, pauseWebhook }))

  await screen.getByRole('button', { name: 'Pause' }).click()

  await expect.element(screen.getByText('pause rejected')).toBeVisible()
})

test('retrying a failed load reloads and recovers the subscription list', async () => {
  const listWebhooks = vi
    .fn(async () => oneSub)
    .mockRejectedValueOnce(new Error('webhooks offline'))
  const screen = await render(routed({ listWebhooks }))

  await screen.getByRole('button', { name: 'Try again' }).click()

  await expect.element(screen.getByText(EXAMPLE_WEBHOOK_URL)).toBeVisible()
})
