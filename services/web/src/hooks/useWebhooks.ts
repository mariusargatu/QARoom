import type {
  WebhookDelivery,
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
} from '@qaroom/contracts'
import { useCallback, useState } from 'react'
import type { ApiClient, CreateWebhookBody } from '../api/client'
import { messageFor } from '../lib/errors'
import { useResource } from './useResource'

export interface DeliveriesView {
  subscriptionId: string
  items: WebhookDelivery[]
  loading: boolean
}

export interface UseWebhooks {
  webhooks: WebhookSubscription[]
  loading: boolean
  error?: string
  busyId?: string
  createError?: string
  /** The last pause/resume/delete failure (RFC-7807 message), for the caller to surface. */
  actionError?: string
  lastSecret?: WebhookSubscriptionWithSecret
  create: (body: CreateWebhookBody) => Promise<void>
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  deliveries?: DeliveriesView
  openDeliveries: (id: string) => Promise<void>
  closeDeliveries: () => void
  refresh: () => Promise<void>
}

/** Manage a community's outbound webhook subscriptions + inspect their delivery ledgers. */
export function useWebhooks(api: ApiClient, communityId: string): UseWebhooks {
  const {
    data: webhooks,
    loading,
    error,
    refresh,
  } = useResource<WebhookSubscription[]>(
    () => api.listWebhooks(communityId).then((list) => [...list.webhooks]),
    [api, communityId],
    [],
  )
  const [busyId, setBusyId] = useState<string | undefined>(undefined)
  const [createError, setCreateError] = useState<string | undefined>(undefined)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [lastSecret, setLastSecret] = useState<WebhookSubscriptionWithSecret | undefined>(undefined)
  const [deliveries, setDeliveries] = useState<DeliveriesView | undefined>(undefined)

  const create = useCallback(
    async (body: CreateWebhookBody) => {
      setBusyId('new')
      setCreateError(undefined)
      try {
        const created = await api.createWebhook(communityId, body)
        setLastSecret(created)
        await refresh()
      } catch (err) {
        setCreateError(messageFor(err))
      } finally {
        setBusyId(undefined)
      }
    },
    [api, communityId, refresh],
  )

  const act = useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
      setBusyId(id)
      setActionError(undefined)
      try {
        await fn()
        await refresh()
      } catch (err) {
        setActionError(messageFor(err))
      } finally {
        setBusyId(undefined)
      }
    },
    [refresh],
  )

  const pause = useCallback(
    (id: string) => act(id, () => api.pauseWebhook(communityId, id)),
    [act, api, communityId],
  )
  const resume = useCallback(
    (id: string) => act(id, () => api.resumeWebhook(communityId, id)),
    [act, api, communityId],
  )
  const remove = useCallback(
    (id: string) => act(id, () => api.deleteWebhook(communityId, id)),
    [act, api, communityId],
  )

  const openDeliveries = useCallback(
    async (id: string) => {
      setDeliveries({ subscriptionId: id, items: [], loading: true })
      try {
        const list = await api.listWebhookDeliveries(communityId, id)
        setDeliveries({ subscriptionId: id, items: [...list.deliveries], loading: false })
      } catch {
        setDeliveries({ subscriptionId: id, items: [], loading: false })
      }
    },
    [api, communityId],
  )
  const closeDeliveries = useCallback(() => setDeliveries(undefined), [])

  return {
    webhooks,
    loading,
    error,
    busyId,
    createError,
    actionError,
    lastSecret,
    create,
    pause,
    resume,
    remove,
    deliveries,
    openDeliveries,
    closeDeliveries,
    refresh,
  }
}
