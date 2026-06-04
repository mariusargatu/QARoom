/**
 * Custom matchers for the Milestone-5 model-based testing story. Like the other matchers in
 * this package they are plain throw-on-mismatch functions (no Vitest coupling), usable from
 * any runner and composable inside Screenplay Questions.
 */

interface SnapshotLike {
  value: unknown
}
interface ActorLike {
  getSnapshot(): SnapshotLike
}

function hasGetSnapshot(actual: unknown): actual is ActorLike {
  return (
    typeof actual === 'object' &&
    actual !== null &&
    'getSnapshot' in actual &&
    typeof (actual as { getSnapshot: unknown }).getSnapshot === 'function'
  )
}

function hasValue(actual: unknown): actual is SnapshotLike {
  return typeof actual === 'object' && actual !== null && 'value' in actual
}

/** Resolve the current state value from an XState actor, a snapshot, or a raw string. */
function currentState(actual: unknown): unknown {
  if (typeof actual === 'string') return actual
  if (hasGetSnapshot(actual)) return actual.getSnapshot().value
  if (hasValue(actual)) return actual.value
  return actual
}

/**
 * Assert a state machine (XState actor, snapshot, or reported state string) is at
 * `expected`. Throws on mismatch; returns the resolved state.
 */
export function expectStateMachineAt(actual: unknown, expected: string): string {
  const state = currentState(actual)
  if (state !== expected) {
    throw new Error(`expected state machine at "${expected}", but it is at "${String(state)}"`)
  }
  return expected
}

export interface TransitionExpectation {
  from: string
  to: string
  event: string
}

interface SpanLike {
  name?: string
  attributes: Record<string, unknown>
}

function isSpanLike(value: unknown): value is SpanLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'attributes' in value &&
    typeof (value as { attributes: unknown }).attributes === 'object'
  )
}

/**
 * Assert that an emitted `xstate.transition` (an OTel ReadableSpan with `xstate.{from,to,event}`
 * attributes, or a plain `{from,to,event}` record) matches the expected transition. This is the
 * reverse-conformance unit-level check that mirrors the Tracetest assertion (ADR-0012).
 */
export function expectTransitionEmitted(
  emitted: SpanLike | TransitionExpectation,
  expected: TransitionExpectation,
): void {
  const actual = isSpanLike(emitted)
    ? {
        from: emitted.attributes['xstate.from'],
        to: emitted.attributes['xstate.to'],
        event: emitted.attributes['xstate.event'],
      }
    : { from: emitted.from, to: emitted.to, event: emitted.event }

  if (
    actual.from !== expected.from ||
    actual.to !== expected.to ||
    actual.event !== expected.event
  ) {
    throw new Error(
      `expected transition ${expected.from} --${expected.event}--> ${expected.to}, ` +
        `got ${String(actual.from)} --${String(actual.event)}--> ${String(actual.to)}`,
    )
  }
}
