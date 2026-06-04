import type { FlagState, RolloutEventName } from '@qaroom/contracts'
import { forwardRef } from 'react'
import { Spinner } from '../../atoms/Spinner'
import { RolloutStepper } from '../../molecules/RolloutStepper'

export interface RolloutPanelProps {
  state: FlagState
  legalEvents: readonly RolloutEventName[]
  loading?: boolean
  pending?: boolean
  onAdvance: (event: RolloutEventName) => void
}

/** Organism: the donations-rollout control card. Composes the RolloutStepper molecule. */
export const RolloutPanel = forwardRef<HTMLElement, RolloutPanelProps>(function RolloutPanel(
  { state, legalEvents, loading = false, pending = false, onAdvance },
  ref,
) {
  return (
    <section
      ref={ref}
      aria-label="Donations rollout"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Donations rollout</h2>
        {loading ? <Spinner label="Loading rollout" /> : null}
      </div>
      <RolloutStepper
        state={state}
        legalEvents={legalEvents}
        pending={pending}
        onAdvance={onAdvance}
      />
    </section>
  )
})
RolloutPanel.displayName = 'RolloutPanel'
