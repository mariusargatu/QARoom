import type { FlagResolution, RolloutEventName } from '@qaroom/contracts'
import { forwardRef } from 'react'
import { legalEventsFor } from '../../../lib/rollout'
import { Skeleton } from '../../atoms/Skeleton'
import { RolloutStepper } from '../../molecules/RolloutStepper'

export interface FlagListProps {
  flags: FlagResolution[]
  loading?: boolean
  error?: string
  pendingKey?: string
  onAdvance: (flagKey: string, event: RolloutEventName) => void
}

/** Organism: every community flag with its rollout state + the legal next transitions. */
export const FlagList = forwardRef<HTMLDivElement, FlagListProps>(function FlagList(
  { flags, loading = false, error, pendingKey, onAdvance },
  ref,
) {
  if (loading) {
    return (
      <div ref={ref} className="divide-y divide-border border-t border-border" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-3 py-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    )
  }
  if (flags.length === 0) {
    return (
      <div ref={ref} className="border-t border-border py-16 text-center">
        <p className="font-display text-xl text-text">No flags resolved</p>
        <p className="mt-1 text-sm text-muted">This community has no flags yet.</p>
      </div>
    )
  }
  return (
    <div ref={ref} className="flex flex-col">
      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="divide-y divide-border border-t border-border">
        {flags.map((flag) => (
          <div key={flag.flag_key} className="flex flex-col gap-3 py-4">
            <h3 className="font-mono text-sm font-semibold text-text">{flag.flag_key}</h3>
            <RolloutStepper
              state={flag.state}
              legalEvents={legalEventsFor(flag.state)}
              pending={pendingKey === flag.flag_key}
              onAdvance={(event) => onAdvance(flag.flag_key, event)}
            />
          </div>
        ))}
      </div>
    </div>
  )
})
FlagList.displayName = 'FlagList'
