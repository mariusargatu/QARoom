import { useRef, useState } from 'react'
import { useResource } from './useResource'

// Harness components for useResource.browser.test.tsx (ADR-0027): the hook's probes live here so the
// browser test imports a stable surface and drives the hook through the DOM. Test-support scaffolding
// only — not imported by the app, so it never ships in the bundle.

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

/**
 * Same race as RaceProbe, but the stale load REJECTS late instead of resolving. Switching A -> B
 * starts a second load; the test resolves B (the latest), then rejects A (stale). The generation
 * guard must drop A's rejection so no error ever surfaces — the `if (gen === latest.current)` false
 * arm in the catch path. Resolvers/rejecters are held in refs and fired by buttons for in-browser
 * ordering control.
 */
export function RaceRejectProbe() {
  const [step, setStep] = useState<'A' | 'B'>('A')
  const resolvers = useRef<Record<string, (value: string) => void>>({})
  const rejecters = useRef<Record<string, (reason: unknown) => void>>({})
  const { data, error } = useResource<string>(
    () =>
      new Promise<string>((resolve, reject) => {
        resolvers.current[step] = resolve
        rejecters.current[step] = reject
      }),
    [step],
    'init',
  )
  return (
    <div>
      <div data-testid="data">{data}</div>
      <div data-testid="error">{error ?? 'no-error'}</div>
      <button type="button" data-testid="to-b" onClick={() => setStep('B')}>
        to b
      </button>
      <button type="button" data-testid="resolve-b" onClick={() => resolvers.current.B?.('B-data')}>
        resolve b
      </button>
      <button
        type="button"
        data-testid="reject-a"
        onClick={() => rejecters.current.A?.(new Error('stale A failed'))}
      >
        reject a
      </button>
    </div>
  )
}
