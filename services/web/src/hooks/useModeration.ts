import type { ModerationDecision } from '@qaroom/contracts'
import type { ApiClient } from '../api/client'
import { useResource } from './useResource'

export interface UseModeration {
  decisions: ModerationDecision[]
  loading: boolean
  error?: string
  refresh: () => Promise<void>
}

/** List a community's grounded moderation decisions (gateway → moderator-agent). */
export function useModeration(api: ApiClient, communityId: string): UseModeration {
  const { data, loading, error, refresh } = useResource<ModerationDecision[]>(
    () => api.listModerationDecisions(communityId).then((list) => [...list.decisions]),
    [api, communityId],
    [],
  )
  return { decisions: data, loading, error, refresh }
}
