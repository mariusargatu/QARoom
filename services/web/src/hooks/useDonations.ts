import type { Donation } from '@qaroom/contracts'
import { useCallback, useState } from 'react'
import type { ApiClient, CreateDonationBody } from '../api/client'
import { messageFor } from '../lib/errors'
import { useResource } from './useResource'

export interface UseDonations {
  donations: Donation[]
  /** True while the LIST is loading. Without it the page renders "No donations yet." mid-flight. */
  loading: boolean
  pending: boolean
  /** Failure of the donate SUBMIT — belongs next to the form. */
  error?: string
  /** Failure of the list READ — belongs where the list would have been, not on the form. */
  listError?: string
  donate: (body: CreateDonationBody) => Promise<void>
  refresh: () => Promise<void>
}

/** List and create donations for a community. */
export function useDonations(api: ApiClient, communityId: string): UseDonations {
  const {
    data: donations,
    loading,
    error: listError,
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

  // Read and write failures were previously collapsed into one `error`, so a failed LIST surfaced as
  // an alert inside the donate form — telling the user their donation failed when they had not made
  // one. They are different events at different places on the page; keep them apart.
  return { donations, loading, pending, error: donateError, listError, donate, refresh }
}
