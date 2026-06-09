import {
  applyRolloutEvent,
  type RolloutEventName,
  RolloutEventName as RolloutEventNameSchema,
  type RolloutState,
} from '@qaroom/contracts'
import { FakeClock } from '@qaroom/testing-utils/determinism'
import type { NormalizedResponse, RequestClient } from '@qaroom/testing-utils/harness'
import type { MachineEdge } from '@qaroom/testing-utils/mbt'
import fc from 'fast-check'
import { expect } from 'vitest'
import { nextKey, SAMPLE } from '../harness'

/**
 * Stateful-PBT command layer over the rollout machine (first `fc.commands` use in the repo).
 *
 * One command per rollout event, ALWAYS runnable: `check()` never filters on legality, because
 * fast-check skips (never executes) commands whose `check()` fails — filtering would make the
 * 409 path unreachable dead code. Instead `run()` derives expected legality from
 * `applyRolloutEvent` — the SAME function the flags-service drives in production — and asserts
 * the matching half of the oracle:
 *   legal   → 200, response echoes the machine's target state, model advances, edge recorded;
 *   illegal → 409 RFC 7807 `rollout-transition-illegal`, live state unchanged, model identity.
 * The illegal half is the established negative-testing pattern for stateful PBT (QuviQ/Hughes;
 * PropEr: the postcondition asserts the error, the model transition is identity).
 *
 * fast-check's model-run contract threads ONE mutable model instance through the sequence, so
 * `model.state` is assigned in place — the framework's documented shape, exempt from the
 * create-new-objects style used in production code. Command instances themselves are stateless
 * (reused across runs and during shrinking); nothing here reads the real system in `check()`.
 */

export interface RolloutModel {
  state: RolloutState
}

export interface RolloutReal {
  request: RequestClient
  recordEdge: (edge: MachineEdge) => void
}

export const ROLLOUT_URL = `/api/communities/${SAMPLE.communityA}/flags/${SAMPLE.flag}/rollout`
export const FLAG_URL = `/api/communities/${SAMPLE.communityA}/flags/${SAMPLE.flag}`

const ILLEGAL_TYPE = 'https://qaroom.dev/errors/rollout-transition-illegal'

/** Legality needs no real time — the clock only stamps the (discarded) transition record. */
const MODEL_CLOCK = new FakeClock()

function stateOf(res: NormalizedResponse): string | undefined {
  return (res.json as { state?: string }).state
}

export class RolloutEventCommand implements fc.AsyncCommand<RolloutModel, RolloutReal> {
  constructor(readonly event: RolloutEventName) {}

  check(): boolean {
    return true
  }

  async run(model: RolloutModel, real: RolloutReal): Promise<void> {
    const applied = applyRolloutEvent(model.state, this.event, { clock: MODEL_CLOCK })
    const key = nextKey()
    const res = await real.request.post(
      ROLLOUT_URL,
      { event: this.event },
      { 'idempotency-key': key },
    )
    if (applied.changed) {
      await this.assertLegal(res, key, applied.to, model, real)
    } else {
      await this.assertIllegal(res, model, real)
    }
  }

  /** Status-message oracle, checked after EVERY command so shrinking lands on the first divergence. */
  private async assertLegal(
    res: NormalizedResponse,
    key: string,
    to: RolloutState,
    model: RolloutModel,
    real: RolloutReal,
  ): Promise<void> {
    expect(res.status, `${this.event} from ${model.state} must be accepted`).toBe(200)
    expect(stateOf(res), `service must echo the machine's target after ${this.event}`).toBe(to)

    // Idempotent replay applies to stored 200s only: same key + same body → same response,
    // and the state must NOT advance twice.
    const replay = await real.request.post(
      ROLLOUT_URL,
      { event: this.event },
      { 'idempotency-key': key },
    )
    expect(replay.status, `replaying ${this.event} with the same key must be served`).toBe(200)
    expect(stateOf(replay), 'an idempotent replay must echo the original state').toBe(to)

    real.recordEdge({ from: model.state, event: this.event, to })
    model.state = to
  }

  /** Negative half: rejection asserted, model transition is identity. */
  private async assertIllegal(
    res: NormalizedResponse,
    model: RolloutModel,
    real: RolloutReal,
  ): Promise<void> {
    expect(res.status, `${this.event} from ${model.state} must be rejected`).toBe(409)
    const body = res.json as { type?: string; failure_domain?: string }
    expect(body.type).toBe(ILLEGAL_TYPE)
    expect(body.failure_domain).toBe('conflict')

    const after = await real.request.get(FLAG_URL)
    expect(stateOf(after), `an illegal ${this.event} must leave the state untouched`).toBe(
      model.state,
    )
  }

  toString(): string {
    return this.event
  }
}

/** One constant command arbitrary per contract event — drawn from the Zod enum, never hand-listed. */
export function rolloutCommandArbitraries(): fc.Arbitrary<RolloutEventCommand>[] {
  return RolloutEventNameSchema.options.map((event) => fc.constant(new RolloutEventCommand(event)))
}
