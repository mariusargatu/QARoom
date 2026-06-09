import type { FlagResolution, RolloutEventName } from '@qaroom/contracts'
import { useCallback, useState } from 'react'
import type { ApiClient } from '../api/client'
import { messageFor } from '../lib/errors'
import { useResource } from './useResource'

/**
 * Well-known flags the platform always supports. `listFlags` only returns flags that already have
 * a row (i.e. have been advanced at least once), so a fresh community lists nothing — yet
 * `donations` is always resolvable and gates the donations feature. We resolve these explicitly and
 * merge them in, so the Flags screen can always control them.
 */
const KNOWN_FLAG_KEYS = ['donations'] as const

export interface UseFlagsList {
  flags: FlagResolution[]
  loading: boolean
  error?: string
  advanceError?: string
  pendingKey?: string
  advance: (flagKey: string, event: RolloutEventName) => Promise<void>
  refresh: () => Promise<void>
}

/** List every resolved flag for a community and advance any flag's rollout. */
export function useFlagsList(api: ApiClient, communityId: string): UseFlagsList {
  const {
    data: flags,
    loading,
    error,
    setData: setFlags,
    refresh,
  } = useResource<FlagResolution[]>(
    async () => {
      const list = await api.listFlags(communityId)
      const present = new Set(list.flags.map((f) => f.flag_key))
      const missing = KNOWN_FLAG_KEYS.filter((key) => !present.has(key))
      const resolved = await Promise.all(
        missing.map((key) => api.resolveFlag(communityId, key).catch(() => null)),
      )
      return [...list.flags, ...resolved.filter((f): f is FlagResolution => f !== null)]
    },
    [api, communityId],
    [],
  )
  const [advanceError, setAdvanceError] = useState<string | undefined>(undefined)
  const [pendingKey, setPendingKey] = useState<string | undefined>(undefined)

  const advance = useCallback(
    async (flagKey: string, event: RolloutEventName) => {
      setPendingKey(flagKey)
      setAdvanceError(undefined)
      try {
        const updated = await api.advanceRollout(communityId, flagKey, event)
        setFlags((prev) => prev.map((f) => (f.flag_key === flagKey ? updated : f)))
      } catch (err) {
        setAdvanceError(messageFor(err))
      } finally {
        setPendingKey(undefined)
      }
    },
    [api, communityId, setFlags],
  )

  return { flags, loading, error, advanceError, pendingKey, advance, refresh }
}
