import type { Post } from '@qaroom/contracts'
import type { Dispatch, SetStateAction } from 'react'
import type { ApiClient } from '../api/client'
import { useResource } from './useResource'

export interface UsePost {
  post: Post | null
  loading: boolean
  error?: string
  setPost: Dispatch<SetStateAction<Post | null>>
  refresh: () => Promise<void>
}

/** Load a single post by id. `setPost` lets a vote update the cached score without a refetch. */
export function usePost(api: ApiClient, postId: string): UsePost {
  const { data, loading, error, setData, refresh } = useResource<Post | null>(
    () => api.getPost(postId),
    [api, postId],
    null,
  )
  return { post: data, loading, error, setPost: setData, refresh }
}
