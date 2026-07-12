import type { Donation } from '@qaroom/contracts'
import { useCallback, useState } from 'react'
import type { ApiClient, CreateDonationBody } from '../api/client'
import { messageFor } from '../lib/errors'
import { useResource } from './useResource'

export interface UseDonations {
  donations: Donation[]
  pending: boolean
  error?: string
  donate: (body: CreateDonationBody) => Promise<void>
  refresh: () => Promise<void>
}

/** List and create donations for a community. */
export function useDonations(api: ApiClient, communityId: string): UseDonations {
  const {
    data: donations,
    error,
    refresh,
  } = useResource<Donation[]>(
    () => api.listDonations(communityId).then((page) => [...page.donations]),
    [api, communityId],
    [],
  )
  const [pending, setPending] = useState(false)
  const [donateError, setDonateError] = useState<string | undefined>(undefined)

  const donate = useCallback(
    async (body: CreateDonationBody) => {
      setPending(true)
      setDonateError(undefined)
      try {
        await api.createDonation(communityId, body)
        await refresh()
      } catch (err) {
        setDonateError(messageFor(err))
      } finally {
        setPending(false)
      }
    },
    [api, communityId, refresh],
  )

  return { donations, pending, error: donateError ?? error, donate, refresh }
}
