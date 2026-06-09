import { useCallback, useState } from 'react'
import type { ApiClient } from '../api/client'
import { messageFor } from '../lib/errors'

export interface UseVote {
  /** The viewer's last cast value per post (for highlighting). */
  myVotes: Record<string, 1 | -1>
  pendingId: string | null
  /** The last vote failure (RFC-7807 message), for the caller to surface. */
  error?: string
  /** Cast a vote; returns the recomputed score so the caller can update its cached post, or
   *  `undefined` if the cast failed (the failure is recorded in `error`). */
  vote: (postId: string, value: 1 | -1) => Promise<number | undefined>
}

/**
 * Cast votes through the gateway as `voterId`. The backend has no un-vote (a vote is +1/-1; removal
 * is a separate, unbuilt concern), so each click casts; `myVotes` only drives the highlight. A
 * failed cast is caught into `error` (not thrown) so it neither becomes an unhandled rejection at
 * the `void onVote(...)` call sites nor fails silently.
 */
export function useVote(api: ApiClient, voterId: string): UseVote {
  const [myVotes, setMyVotes] = useState<Record<string, 1 | -1>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)

  const vote = useCallback(
    async (postId: string, value: 1 | -1) => {
      setPendingId(postId)
      setError(undefined)
      try {
        const result = await api.castVote(postId, { voter_id: voterId, value })
        setMyVotes((prev) => ({ ...prev, [postId]: value }))
        return result.score
      } catch (err) {
        setError(messageFor(err))
        return undefined
      } finally {
        setPendingId(null)
      }
    },
    [api, voterId],
  )

  return { myVotes, pendingId, error, vote }
}
