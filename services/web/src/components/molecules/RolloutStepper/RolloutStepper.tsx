import type { FlagState, RolloutEventName } from '@qaroom/contracts'
import { TESTID } from '@qaroom/testing-utils/testids'
import { forwardRef } from 'react'
import { Badge, type BadgeTone } from '../../atoms/Badge'
import { Button } from '../../atoms/Button'

export interface RolloutStepperProps {
  state: FlagState
  /** The events legal from `state` (the organism derives these from the rollout machine). */
  legalEvents: readonly RolloutEventName[]
  pending?: boolean
  onAdvance: (event: RolloutEventName) => void
}

const TONE: Record<FlagState, BadgeTone> = {
  Off: 'neutral',
  Enabling: 'primary',
  Canary: 'warning',
  Enabled: 'success',
  Disabling: 'danger',
}

/** Molecule: shows the current rollout state and a button per legal next event. */
export const RolloutStepper = forwardRef<HTMLDivElement, RolloutStepperProps>(
  function RolloutStepper({ state, legalEvents, pending = false, onAdvance }, ref) {
    return (
      <div ref={ref} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Rollout state</span>
          <Badge tone={TONE[state]} data-testid={TESTID.rolloutState}>
            {state}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {legalEvents.map((event) => (
            <Button
              key={event}
              variant={
                event === 'DisableRequested' || event === 'RolloutAborted' ? 'danger' : 'primary'
              }
              disabled={pending}
              data-testid={TESTID.rolloutAdvance(event)}
              onClick={() => onAdvance(event)}
            >
              {event}
            </Button>
          ))}
        </div>
      </div>
    )
  },
)
RolloutStepper.displayName = 'RolloutStepper'
