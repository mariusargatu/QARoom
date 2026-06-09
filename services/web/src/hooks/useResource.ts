import {
  type DependencyList,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { messageFor } from '../lib/errors'

export interface UseResource<T> {
  data: T
  loading: boolean
  error?: string
  /** The raw state setter — lets a caller patch the cache in place (optimistic update) or refetch. */
  setData: Dispatch<SetStateAction<T>>
  refresh: () => Promise<void>
}

/**
 * Load-on-mount resource. Runs `loader` on mount and whenever `deps` change, tracking
 * loading/error (RFC-7807 message via `messageFor`) and exposing `refresh`. This is the one
 * skeleton the feed / post / members / moderation / flags / webhooks hooks all repeated; each now
 * composes this and layers its own mutations on top. `deps` are the loader's inputs (api, ids).
 */
export function useResource<T>(
  loader: () => Promise<T>,
  deps: DependencyList,
  initial: T,
): UseResource<T> {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)

  // `deps` is the caller-declared dependency set for the loader closure; biome can't statically
  // verify a forwarded array, so the loader is memoized on exactly what the caller passes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps is the caller's declared loader input set
  const load = useCallback(loader, deps)

  // Generation guard: each refresh claims the next ticket; only the latest in-flight load commits
  // its result. Without it, changing `deps` (e.g. navigating community A -> B) leaves two loads
  // racing and a slow A could overwrite B's data — rendering the wrong resource until the next
  // refresh. Also stops state writes from a load that lost the race / outlived the component.
  const latest = useRef(0)
  const refresh = useCallback(async () => {
    latest.current += 1
    const gen = latest.current
    setLoading(true)
    setError(undefined)
    try {
      const result = await load()
      if (gen === latest.current) setData(result)
    } catch (err) {
      if (gen === latest.current) setError(messageFor(err))
    } finally {
      if (gen === latest.current) setLoading(false)
    }
  }, [load])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, setData, refresh }
}
