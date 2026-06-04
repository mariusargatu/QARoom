import { createTestModel } from '@xstate/graph'
import type { AnyStateMachine } from 'xstate'

/**
 * Model-based-testing path generation (Milestone 5, ADR-0005). Turns an XState machine into a
 * set of paths — each an ordered sequence of (event → resulting state) steps — that a
 * Screenplay flow replays against the live system. `@xstate/graph@3.0.4` is pinned EXACT
 * because the traversal options and invoke-rejection used here are undocumented internals a
 * minor bump could change.
 *
 * Two load-bearing options (both from hard-won experience, ADR-0005):
 *  - `allowDuplicatePaths: true` — the default dedup drops prefix paths and silently shrinks
 *    coverage; we keep them.
 *  - `serializeState: s => JSON.stringify(s.value)` — value-only serialization keeps the
 *    context-free model from multiplying states (any context would explode the BFS).
 */

export interface GeneratedStep {
  /** The event type that produced `state`. */
  event: string
  /** The serialized state value reached after the event. */
  state: string
}

export interface GeneratedPath {
  /** The serialized state value the path ends in. */
  target: string
  /** Ordered (event → state) steps reaching `target`. */
  steps: GeneratedStep[]
  /** Human-readable path summary, used for test naming. */
  description: string
}

/** Default MBT depth bounds (roadmap): PR CI shortest at 10, nightly simple at 20. */
export const PR_MAX_DEPTH = 10
export const NIGHTLY_MAX_DEPTH = 20

export interface PathOptions {
  /** Drop any path longer than this many steps. Omit to keep all. */
  maxDepth?: number
  /**
   * BFS iteration cap passed to `@xstate/graph` (NOT a path-count cap — that is `assertPathCount`).
   * Bounds traversal cost on a large or accidentally-cyclic model. Defaults to 2000.
   */
  limit?: number
}

const DEFAULT_LIMIT = 2000

/** Shortest paths to every reachable state — the PR-CI generator. */
export function shortestPaths(machine: AnyStateMachine, opts: PathOptions = {}): GeneratedPath[] {
  const paths = createTestModel(machine).getShortestPaths({
    allowDuplicatePaths: true,
    serializeState: (state) => JSON.stringify(state.value),
    limit: opts.limit ?? DEFAULT_LIMIT,
  })
  return bound(paths.map(toGenerated), opts.maxDepth)
}

/** Every simple (acyclic) path — the nightly, more-exhaustive generator. */
export function simplePaths(machine: AnyStateMachine, opts: PathOptions = {}): GeneratedPath[] {
  const paths = createTestModel(machine).getSimplePaths({
    allowDuplicatePaths: true,
    serializeState: (state) => JSON.stringify(state.value),
    limit: opts.limit ?? DEFAULT_LIMIT,
  })
  return bound(paths.map(toGenerated), opts.maxDepth)
}

export interface PathCountBounds {
  /** A model that shrinks below this many paths fails CI — a regression erased states. */
  floor: number
  /** Upper bound so an accidental state explosion is caught too. */
  cap: number
}

/**
 * Gate the generated path set against a floor AND a cap. The floor is the load-bearing half:
 * a silent regression that deletes a reachable state would otherwise just produce fewer paths
 * and pass. Throws (with a descriptive message) when the count is out of bounds.
 */
export function assertPathCount(paths: readonly GeneratedPath[], bounds: PathCountBounds): void {
  if (paths.length < bounds.floor) {
    throw new Error(
      `MBT path count ${paths.length} is below the floor ${bounds.floor} — a regression may have erased reachable states`,
    )
  }
  if (paths.length > bounds.cap) {
    throw new Error(
      `MBT path count ${paths.length} is above the cap ${bounds.cap} — the model may have exploded`,
    )
  }
}

interface RawPath {
  state: { value: unknown }
  steps: Array<{ event: { type: string }; state: { value: unknown } }>
}

/** XState seeds every path with a synthetic init event reaching the initial state; it is not a real transition. */
const XSTATE_INIT = 'xstate.init'

function toGenerated(path: RawPath): GeneratedPath {
  const steps = path.steps
    .filter((step) => step.event.type !== XSTATE_INIT)
    .map((step) => ({
      event: step.event.type,
      state: JSON.stringify(step.state.value),
    }))
  const events = steps.map((s) => s.event)
  return {
    target: JSON.stringify(path.state.value),
    steps,
    description: events.length > 0 ? events.join(' → ') : '(initial state)',
  }
}

function bound(paths: GeneratedPath[], maxDepth?: number): GeneratedPath[] {
  if (maxDepth === undefined) return paths
  return paths.filter((p) => p.steps.length <= maxDepth)
}
