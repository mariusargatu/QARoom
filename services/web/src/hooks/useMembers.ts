import type { Membership, Role } from '@qaroom/contracts'
import { useCallback, useState } from 'react'
import type { ApiClient } from '../api/client'
import { messageFor } from '../lib/errors'
import { useSession } from '../session/SessionProvider'
import { useResource } from './useResource'

export interface UseMembers {
  members: Membership[]
  loading: boolean
  error?: string
  adding: boolean
  addError?: string
  addMember: (userId: string, role: Role) => Promise<void>
  refresh: () => Promise<void>
}

/** List a community's members and grant new ones (gateway-proxied identity surface). */
export function useMembers(api: ApiClient, communityId: string): UseMembers {
  const { currentUser, refreshToken } = useSession()
  const {
    data: members,
    loading,
    error,
    refresh,
  } = useResource<Membership[]>(
    () => api.listMembers(communityId).then((list) => [...list.members]),
    [api, communityId],
    [],
  )
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | undefined>(undefined)

  const addMember = useCallback(
    async (userId: string, role: Role) => {
      setAdding(true)
      setAddError(undefined)
      try {
        await api.addMembership(communityId, { user_id: userId, role })
        if (userId === currentUser?.id) await refreshToken()
        await refresh()
      } catch (err) {
        setAddError(messageFor(err))
      } finally {
        setAdding(false)
      }
    },
    [api, communityId, currentUser, refreshToken, refresh],
  )

  return { members, loading, error, adding, addError, addMember, refresh }
}
