import { expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient, CreateWebhookBody } from '../api/client'
import { useWebhooks } from './useWebhooks'

// Hook test (ADR-0027): useWebhooks composes the shared useResource (list-on-mount) but adds the whole
// subscription-lifecycle delta of its own — create (revealing the write-once secret + refresh),
// pause/resume/remove (the `act` path with its actionError), and the deliveries-ledger view. A fake
// ApiClient drives the hook; the plain useResource load/error path is proven by useResource's own test.

const body = {
  url: 'https://example.com/hook',
  event_types: ['post.created'],
} as unknown as CreateWebhookBody

test('lists the community webhooks on mount', async () => {
  const listWebhooks = vi.fn(async () => ({ community_id: 'comm_1', webhooks: [{ id: 'whk_1' }] }))
  const api = { listWebhooks } as unknown as ApiClient
  const { result } = await renderHook(() => useWebhooks(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.webhooks).toEqual([{ id: 'whk_1' }]))
  expect(listWebhooks).toHaveBeenCalledWith('comm_1')
})

test('create reveals the write-once secret and refreshes the list', async () => {
  const created = { id: 'whk_1', secret: 's3cr3t' }
  const listWebhooks = vi.fn(async () => ({ community_id: 'comm_1', webhooks: [] }))
  const createWebhook = vi.fn(async () => created)
  const api = { listWebhooks, createWebhook } as unknown as ApiClient
  const { result } = await renderHook(() => useWebhooks(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.loading).toBe(false))
  await result.current.create(body)

  expect(createWebhook).toHaveBeenCalledWith('comm_1', body)
  await vi.waitFor(() => expect(result.current.lastSecret).toEqual(created))
  expect(listWebhooks).toHaveBeenCalledTimes(2)
})

test('a failed create surfaces createError and never throws', async () => {
  const listWebhooks = vi.fn(async () => ({ community_id: 'comm_1', webhooks: [] }))
  const createWebhook = async () => {
    throw new Error('url is not a public https host')
  }
  const api = { listWebhooks, createWebhook } as unknown as ApiClient
  const { result } = await renderHook(() => useWebhooks(api, 'comm_1'))

  await result.current.create(body)

  await vi.waitFor(() => expect(result.current.createError).toBe('url is not a public https host'))
})

test('a failed pause/resume/remove surfaces actionError and clears the busy id', async () => {
  const listWebhooks = vi.fn(async () => ({ community_id: 'comm_1', webhooks: [{ id: 'whk_1' }] }))
  const deleteWebhook = async () => {
    throw new Error('subscription not found')
  }
  const api = { listWebhooks, deleteWebhook } as unknown as ApiClient
  const { result } = await renderHook(() => useWebhooks(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.loading).toBe(false))
  await result.current.remove('whk_1')

  await vi.waitFor(() => expect(result.current.actionError).toBe('subscription not found'))
  expect(result.current.busyId).toBeUndefined()
})

test('openDeliveries loads the selected subscription ledger', async () => {
  const listWebhooks = vi.fn(async () => ({ community_id: 'comm_1', webhooks: [{ id: 'whk_1' }] }))
  const listWebhookDeliveries = vi.fn(async () => ({
    subscription_id: 'whk_1',
    deliveries: [{ id: 'del_1' }],
  }))
  const api = { listWebhooks, listWebhookDeliveries } as unknown as ApiClient
  const { result } = await renderHook(() => useWebhooks(api, 'comm_1'))

  await vi.waitFor(() => expect(result.current.loading).toBe(false))
  await result.current.openDeliveries('whk_1')

  await vi.waitFor(() => {
    expect(result.current.deliveries?.subscriptionId).toBe('whk_1')
    expect(result.current.deliveries?.items).toEqual([{ id: 'del_1' }])
  })
  expect(listWebhookDeliveries).toHaveBeenCalledWith('comm_1', 'whk_1')
})

test('closeDeliveries clears the open ledger view', async () => {
  const listWebhooks = vi.fn(async () => ({ community_id: 'comm_1', webhooks: [{ id: 'whk_1' }] }))
  const listWebhookDeliveries = vi.fn(async () => ({ subscription_id: 'whk_1', deliveries: [] }))
  const api = { listWebhooks, listWebhookDeliveries } as unknown as ApiClient
  const { result } = await renderHook(() => useWebhooks(api, 'comm_1'))

  await result.current.openDeliveries('whk_1')
  await vi.waitFor(() => expect(result.current.deliveries).toBeDefined())
  result.current.closeDeliveries()

  await vi.waitFor(() => expect(result.current.deliveries).toBeUndefined())
})
