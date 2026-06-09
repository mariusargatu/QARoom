import type { Post } from '@qaroom/contracts'
import type { Dispatch, SetStateAction } from 'react'
import type { ApiClient } from '../api/client'
import { useResource } from './useResource'

export interface UseFeed {
  posts: Post[]
  loading: boolean
  error?: string
  /** Patch the cached posts in place (used to update a score after an optimistic vote). */
  setPosts: Dispatch<SetStateAction<Post[]>>
  refresh: () => Promise<void>
}

/** Load a community's feed (newest first) from the gateway. */
export function useFeed(api: ApiClient, communityId: string): UseFeed {
  const { data, loading, error, setData, refresh } = useResource<Post[]>(
    () => api.listFeed(communityId).then((feed) => [...feed.posts]),
    [api, communityId],
    [],
  )
  return { posts: data, loading, error, setPosts: setData, refresh }
}
