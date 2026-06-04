import type { Donation } from '@qaroom/contracts'
import { useCallback, useEffect, useState } from 'react'
import type { ApiClient, CreateDonationBody } from '../api/client'

export interface UseDonations {
  donations: Donation[]
  pending: boolean
  donate: (body: CreateDonationBody) => Promise<void>
  refresh: () => Promise<void>
}

/** List and create donations for a community. */
export function useDonations(api: ApiClient, communityId: string): UseDonations {
  const [donations, setDonations] = useState<Donation[]>([])
  const [pending, setPending] = useState(false)

  const refresh = useCallback(async () => {
    const page = await api.listDonations(communityId)
    setDonations([...page.donations])
  }, [api, communityId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const donate = useCallback(
    async (body: CreateDonationBody) => {
      setPending(true)
      try {
        await api.createDonation(communityId, body)
        await refresh()
      } finally {
        setPending(false)
      }
    },
    [api, communityId, refresh],
  )

  return { donations, pending, donate, refresh }
}
