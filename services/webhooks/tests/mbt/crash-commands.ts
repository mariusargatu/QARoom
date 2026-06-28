import {
  applyWebhookDeliveryEvent,
  isWebhookDeliveryTerminal,
  WEBHOOK_RETRY_POLICY,
  type WebhookDeliveryStateName,
} from '@qaroom/contracts'
import { FakeClock } from '@qaroom/testing-utils/determinism'
import fc from 'fast-check'
import { expect } from 'vitest'
import { assertLegalDeliveryCommit } from '../../src/delivery-invariant'

/**
 * MBT × fault command layer over the webhook-delivery machine (T19, ADR-0024 Phase 3).
 *
 * Model-based testing (commands drawn from the hand-authored XState delivery machine) COMPOSED with a
 * fault injected at a model transition: a crash mid-attempt (pod-kill before the DB commit). The
 * "real" system under test is a tiny in-process COMMITTED-delivery store that mirrors
 * `worker.ts#attemptOne/persist` exactly — it drives the REAL machine runner (`applyWebhookDeliveryEvent`)
 * for each in-memory leg and calls the REAL runtime binding (`assertLegalDeliveryCommit`) before every
 * commit, with the REAL `WEBHOOK_RETRY_POLICY` budget. So the invariants asserted here are the
 * production ones; the fault is the crash the TLA model abstracts ("the in-memory AttemptStarted →
 * Delivering leg is never persisted, so a crash leaves the row re-claimable — at-least-once").
 *
 * This is the deterministic, model-level twin of the full-system crash the DST slice fuzzes with
 * `failingDb` (tests/dst). MBT generates the command sequences; the crash is the injected fault; the
 * binding + the invariant checks are the oracle. fast-check threads one mutable model + real through a
 * sequence, asserting the WebhookDelivery.tla invariants after EVERY step, so a violation shrinks to
 * the minimal command sequence.
 */

export const MAX = WEBHOOK_RETRY_POLICY.max_attempts

// Legality needs no real time — the clock only stamps the (discarded) transition record.
const CLOCK = new FakeClock()

export interface DeliveryModel {
  status: WebhookDeliveryStateName
  attempt: number
  /** Did a real 2xx response cause the Delivered state? The NoSilentDrop oracle. */
  delivered2xx: boolean
}

export interface DeliveryReal {
  status: WebhookDeliveryStateName
  attempt: number
}

export const freshModel = (): DeliveryModel => ({
  status: 'Pending',
  attempt: 0,
  delivered2xx: false,
})
export const freshReal = (): DeliveryReal => ({ status: 'Pending', attempt: 0 })

/** A re-claimable committed state — the only states the worker starts an attempt from. */
export const reclaimable = (status: WebhookDeliveryStateName): boolean =>
  status === 'Pending' || status === 'Retrying'

/** Mirror of worker.ts#persist: assert the committed edge is legal, then advance the committed row. */
function persist(
  real: DeliveryReal,
  from: WebhookDeliveryStateName,
  to: WebhookDeliveryStateName,
  attempt: number,
): void {
  assertLegalDeliveryCommit(from, to, attempt, MAX)
  real.status = to
  real.attempt = attempt
}

/** A delivery attempt that gets a 2xx: drives the real machine legs, commits Delivered. */
export function commitSuccess(real: DeliveryReal): void {
  const from = real.status
  applyWebhookDeliveryEvent(from, 'AttemptStarted', { clock: CLOCK })
  applyWebhookDeliveryEvent('Delivering', 'DeliverySucceeded', { clock: CLOCK })
  persist(real, from, 'Delivered', real.attempt)
}

/** A delivery attempt that fails: Retrying while budget remains, else DeadLettered (mirrors the worker). */
export function commitFailure(real: DeliveryReal): void {
  const from = real.status
  applyWebhookDeliveryEvent(from, 'AttemptStarted', { clock: CLOCK })
  const next = real.attempt + 1
  if (next < MAX) {
    applyWebhookDeliveryEvent('Delivering', 'DeliveryFailed', { clock: CLOCK })
    persist(real, from, 'Retrying', next)
  } else {
    applyWebhookDeliveryEvent('Delivering', 'RetriesExhausted', { clock: CLOCK })
    persist(real, from, 'DeadLettered', next)
  }
}

/**
 * THE FAULT: a pod-kill after the in-memory AttemptStarted → Delivering leg but BEFORE the DB commit.
 * The transaction rolls back, so the committed row is never advanced — it stays re-claimable. We
 * exercise the real machine's in-memory leg, then commit NOTHING (the rollback).
 */
export function crashMidAttempt(real: DeliveryReal): void {
  applyWebhookDeliveryEvent(real.status, 'AttemptStarted', { clock: CLOCK })
  // No persist: the committed (real) state is unchanged. At-least-once: the row is re-claimed later.
}

/** The WebhookDelivery.tla invariants, asserted on committed state after every command. */
export function assertInvariants(model: DeliveryModel, real: DeliveryReal): void {
  expect(real.status, 'committed status tracks the model').toBe(model.status)
  expect(real.attempt, 'committed attempt tracks the model').toBe(model.attempt)
  // NoSilentDrop: Delivered only after a real 2xx.
  expect(real.status !== 'Delivered' || model.delivered2xx).toBe(true)
  // ExhaustionLegit: DeadLettered only once the full budget is spent.
  expect(real.status !== 'DeadLettered' || real.attempt === MAX).toBe(true)
  // NoStuckDelivery / at-least-once spine: a non-terminal delivery stays re-claimable.
  expect(isWebhookDeliveryTerminal(real.status) || reclaimable(real.status)).toBe(true)
}

export class SucceedCommand implements fc.Command<DeliveryModel, DeliveryReal> {
  check(model: DeliveryModel): boolean {
    return reclaimable(model.status)
  }

  run(model: DeliveryModel, real: DeliveryReal): void {
    commitSuccess(real)
    model.status = 'Delivered'
    model.delivered2xx = true
    assertInvariants(model, real)
  }

  toString(): string {
    return 'Succeed'
  }
}

export class FailCommand implements fc.Command<DeliveryModel, DeliveryReal> {
  check(model: DeliveryModel): boolean {
    return reclaimable(model.status)
  }

  run(model: DeliveryModel, real: DeliveryReal): void {
    const next = model.attempt + 1
    commitFailure(real)
    model.status = next < MAX ? 'Retrying' : 'DeadLettered'
    model.attempt = next
    assertInvariants(model, real)
  }

  toString(): string {
    return 'Fail'
  }
}

export class CrashCommand implements fc.Command<DeliveryModel, DeliveryReal> {
  check(model: DeliveryModel): boolean {
    return reclaimable(model.status)
  }

  run(model: DeliveryModel, real: DeliveryReal): void {
    const before = real.status
    crashMidAttempt(real)
    // The fault must not advance committed state, and the row must remain re-claimable.
    expect(real.status, 'a crash mid-attempt rolls back: committed state unchanged').toBe(before)
    expect(reclaimable(real.status), 'a crashed delivery stays re-claimable (at-least-once)').toBe(
      true,
    )
    assertInvariants(model, real)
  }

  toString(): string {
    return 'Crash'
  }
}

/** The command menu: each event/fault as a constant arbitrary (fast-check draws sequences). */
export function deliveryCommandArbitraries(): fc.Arbitrary<
  fc.Command<DeliveryModel, DeliveryReal>
>[] {
  return [
    fc.constant(new SucceedCommand()),
    fc.constant(new FailCommand()),
    fc.constant(new CrashCommand()),
  ]
}
