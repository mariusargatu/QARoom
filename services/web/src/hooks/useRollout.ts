import { type FlagState, type RolloutEventName, rolloutMachine } from '@qaroom/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiClient } from '../api/client'

const DONATIONS_FLAG = 'donations'

/**
 * The events legal from a state, read from the SAME rollout machine the server drives — so the
 * UI can only offer transitions the machine (and therefore the server) will accept. This is the
 * single source of legal transitions on the client side.
 */
function legalEventsFor(state: FlagState): RolloutEventName[] {
  const states = rolloutMachine.config.states ?? {}
  const on = (states[state] as { on?: Record<string, unknown> } | undefined)?.on ?? {}
  return Object.keys(on) as RolloutEventName[]
}

export interface UseRollout {
  state: FlagState
  legalEvents: RolloutEventName[]
  loading: boolean
  pending: boolean
  advance: (event: RolloutEventName) => Promise<void>
}

/** Track and advance the donations rollout for a community against the gateway. */
export function useRollout(api: ApiClient, communityId: string): UseRollout {
  const [state, setState] = useState<FlagState>('Off')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    api
      .resolveFlag(communityId, DONATIONS_FLAG)
      .then((r) => {
        if (active) setState(r.state)
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
      try {
        const r = await api.advanceRollout(communityId, DONATIONS_FLAG, event)
        setState(r.state)
      } finally {
        setPending(false)
      }
    },
    [api, communityId],
  )

  // Legal events depend only on `state`; memoize so the 2s poll re-renders don't rebuild it.
  const legalEvents = useMemo(() => legalEventsFor(state), [state])
  return { state, legalEvents, loading, pending, advance }
}
