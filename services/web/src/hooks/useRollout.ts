import type { FlagState, RolloutEventName } from '@qaroom/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiClient } from '../api/client'
import { messageFor } from '../lib/errors'
import { legalEventsFor } from '../lib/rollout'

const DONATIONS_FLAG = 'donations'

export interface UseRollout {
  state: FlagState
  legalEvents: RolloutEventName[]
  loading: boolean
  pending: boolean
  /**
   * Set when the flag could not be READ. Callers must branch on this before rendering `state`:
   * `state` is `'Off'` until a resolve succeeds, so on failure it is an initial value, not a fact.
   */
  error?: string
  advance: (event: RolloutEventName) => Promise<void>
}

/** Track and advance the donations rollout for a community against the gateway. */
export function useRollout(api: ApiClient, communityId: string): UseRollout {
  const [state, setState] = useState<FlagState>('Off')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    api
      .resolveFlag(communityId, DONATIONS_FLAG)
      .then((r) => {
        if (active) setState(r.state)
      })
      // A `.finally` with no `.catch` does not handle the rejection — it re-throws it as an
      // unhandled promise rejection, clears `loading`, and leaves `state` at its 'Off' initial. The
      // page then renders "Donations are not enabled for this community yet (rollout state: Off)":
      // a flags-service outage stated to the user as a fact about their community's configuration.
      .catch((err) => {
        if (active) setError(messageFor(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, communityId])

  const advance = useCallback(
    async (event: RolloutEventName) => {
      setPending(true)
      setError(undefined)
      try {
        const r = await api.advanceRollout(communityId, DONATIONS_FLAG, event)
        setState(r.state)
      } catch (err) {
        setError(messageFor(err))
      } finally {
        setPending(false)
      }
    },
    [api, communityId],
  )

  // Legal events depend only on `state`; memoize so the 2s poll re-renders don't rebuild it.
  const legalEvents = useMemo(() => legalEventsFor(state), [state])
  return { state, legalEvents, loading, pending, error, advance }
}
