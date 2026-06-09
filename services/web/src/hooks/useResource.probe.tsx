import { useRef, useState } from 'react'
import { useResource } from './useResource'

// CT harness components for useResource.ct.tsx. Playwright CT can only mount IMPORTED components
// (its Vite build compiles them), not ones defined in the test file — so the hook's probes live
// here. Test-support scaffolding only: not imported by the app, so it never ships in the bundle.

/** Resolves on mount. */
export function OkProbe() {
  const { data } = useResource<string>(() => Promise.resolve('loaded'), [], 'init')
  return (
    <div>
      <div data-testid="data">{data}</div>
    </div>
  )
}

/** Rejects on mount — the error must surface via `messageFor`. */
export function ErrProbe() {
  const { data, error } = useResource<string>(
    () => Promise.reject(new Error('load failed')),
    [],
    'init',
  )
  return (
    <div>
      <div data-testid="data">{data}</div>
      <div data-testid="error">{error ?? ''}</div>
    </div>
  )
}

/**
 * Two loads race: switching the dep from A to B starts a second load while A is still in flight.
 * The test resolves B (the latest) first, then A (stale) late — the generation guard must drop A.
 * Resolvers are held in a ref and fired by buttons, so the test controls ordering purely in-browser.
 */
export function RaceProbe() {
  const [step, setStep] = useState<'A' | 'B'>('A')
  const resolvers = useRef<Record<string, (value: string) => void>>({})
  const { data } = useResource<string>(
    () =>
      new Promise<string>((resolve) => {
        resolvers.current[step] = resolve
      }),
    [step],
    'init',
  )
  return (
    <div>
      <div data-testid="data">{data}</div>
      <button type="button" data-testid="to-b" onClick={() => setStep('B')}>
        to b
      </button>
      <button type="button" data-testid="resolve-a" onClick={() => resolvers.current.A?.('A-data')}>
        resolve a
      </button>
      <button type="button" data-testid="resolve-b" onClick={() => resolvers.current.B?.('B-data')}>
        resolve b
      </button>
    </div>
  )
}
