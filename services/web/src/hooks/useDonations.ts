import type { Donation } from '@qaroom/contracts'
import { useCallback, useEffect, useState } from 'react'
import type { ApiClient, CreateDonationBody } from '../api/client'
import { messageFor } from '../lib/errors'

export interface UseDonations {
  donations: Donation[]
  pending: boolean
  error?: string
  donate: (body: CreateDonationBody) => Promise<void>
  refresh: () => Promise<void>
}

/** List and create donations for a community. */
export function useDonations(api: ApiClient, communityId: string): UseDonations {
  const [donations, setDonations] = useState<Donation[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      const page = await api.listDonations(communityId)
      setDonations([...page.donations])
    } catch (err) {
      setError(messageFor(err))
    }
  }, [api, communityId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const donate = useCallback(
    async (body: CreateDonationBody) => {
      setPending(true)
      setError(undefined)
      try {
        await api.createDonation(communityId, body)
        await refresh()
      } catch (err) {
        setError(messageFor(err))
      } finally {
        setPending(false)
      }
    },
    [api, communityId, refresh],
  )

  return { donations, pending, error, donate, refresh }
}
