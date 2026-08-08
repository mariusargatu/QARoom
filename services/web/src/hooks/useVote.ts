import { useCallback, useState } from 'react'
import type { ApiClient } from '../api/client'
import { messageFor } from '../lib/errors'

export interface UseVote {
  /** The viewer's last cast value per post (for highlighting). */
  myVotes: Record<string, 1 | -1>
  /** In-flight votes, keyed by post id — concurrent casts do not clear each other. */
  pending: Record<string, true>
  isPending: (postId: string) => boolean
  /** Vote failures keyed by post id, so one post's failure cannot erase another's. */
  errors: Record<string, string>
  /** Any one current failure, for a page-level banner. */
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
  const [pending, setPending] = useState<Record<string, true>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isPending = useCallback((postId: string) => pending[postId] === true, [pending])
  // One representative message for a page-level banner; `errors` keeps the per-post detail.
  const error = Object.values(errors)[0]

  const vote = useCallback(
    async (postId: string, value: 1 | -1) => {
      // Track the in-flight SET, not a single id. With one shared `pendingId`, voting on post A then
      // post B before A settles meant A's completion cleared B's pending state: B's row re-enabled
      // its buttons while B's request was still in flight, inviting a second cast. Symmetrically,
      // clearing a shared `error` on each new vote wiped A's failure message before it was read.
      setPending((prev) => ({ ...prev, [postId]: true }))
      setErrors((prev) => {
        const { [postId]: _dropped, ...rest } = prev
        return rest
      })
      try {
        const result = await api.castVote(postId, { voter_id: voterId, value })
        setMyVotes((prev) => ({ ...prev, [postId]: value }))
        return result.score
      } catch (err) {
        setErrors((prev) => ({ ...prev, [postId]: messageFor(err) }))
        return undefined
      } finally {
        setPending((prev) => {
          const { [postId]: _done, ...rest } = prev
          return rest
        })
      }
    },
    [api, voterId],
  )

  return { myVotes, pending, isPending, errors, error, vote }
}
