import { SystemState } from '@qaroom/contracts'

/** Read the lamport counter from a `/system/state` body, parsed through the SystemState contract. */
export function lamportOf(state: unknown): number {
  return SystemState.parse(state).as_of.lamport
}

/** Assert the lamport counter strictly advanced (a tracked write occurred). */
export function expectLamportAdvanced(before: number, after: number): void {
  if (!(after > before)) {
    throw new Error(`expected lamport to advance, but ${after} is not greater than ${before}`)
  }
}

/** Assert the lamport counter did NOT advance (no tracked write occurred). */
export function expectLamportStable(before: number, after: number): void {
  if (after !== before) {
    throw new Error(`expected lamport to stay at ${before}, but it moved to ${after}`)
  }
}
