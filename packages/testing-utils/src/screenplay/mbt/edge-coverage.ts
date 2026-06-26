import { type AnyStateMachine, createActor } from 'xstate'
import type { GeneratedPath } from './generate-paths'

/**
 * Edge-coverage bridge for model-based testing (the all-transitions criterion).
 *
 * `@xstate/graph`'s `getShortestPaths`/`getSimplePaths` guarantee reaching every STATE
 * (node coverage), not crossing every TRANSITION (edge coverage): a back-edge into an
 * already-visited state is never on a shortest path, and a path revisiting a state is not
 * "simple", so cyclic edges (e.g. the rollout machine's three back-to-`Off` edges) are
 * structurally invisible to both generators. Edge coverage — "all-transitions", the 0-switch
 * criterion — is the minimum practitioners consider adequate for state-based testing
 * (Ammann & Offutt's graph-coverage hierarchy; ISTQB CT-MBT calls all-states "the weakest").
 *
 * This module supplies the missing denominator and the bookkeeping: enumerate every declared
 * edge of a machine, record the edges a test run actually crossed (whether by generated paths
 * or by a stateful property-based walk), and report the gap so a driver can fill it
 * deterministically — the same shape as GraphWalker's `quick_random` + `edge_coverage(100%)`
 * stop condition, decomposed into reset-separated paths.
 */

/** One declared machine transition. The unit of the all-transitions coverage criterion. */
export interface MachineEdge {
  from: string
  event: string
  to: string
}

/** Canonical identity of an edge — plain (unquoted) state names joined with `|`. */
export function edgeKey(edge: MachineEdge): string {
  return `${edge.from}|${edge.event}|${edge.to}`
}

interface TransitionConfig {
  target?: string
}

type StateConfigs = Record<
  string,
  { on?: Record<string, TransitionConfig | TransitionConfig[] | string> }
>

function targetOf(transition: TransitionConfig | TransitionConfig[] | string): string | undefined {
  if (typeof transition === 'string') return transition
  if (Array.isArray(transition)) return transition[0]?.target
  return transition.target
}

/**
 * Every declared edge of a flat, context-free machine, read straight from
 * `machine.config.states[*].on[*].target` — the same shape reverse-conformance's
 * `isLegalEdge` checks one transition against, enumerated exhaustively. This is the
 * coverage DENOMINATOR; path generators must never be trusted to supply it.
 */
export function allEdges(machine: AnyStateMachine): MachineEdge[] {
  const states = (machine.config.states ?? {}) as StateConfigs
  return Object.entries(states).flatMap(([from, config]) =>
    Object.entries(config.on ?? {}).flatMap(([event, transition]) => {
      const to = targetOf(transition)
      return to === undefined ? [] : [{ from, event, to }]
    }),
  )
}

/** A (state, event) combination with NO declared transition — the negative-coverage unit. */
export interface IllegalPair {
  state: string
  event: string
}

/**
 * Every (state, event) pair the machine declares NO transition for. The negative complement of
 * `allEdges`: legal all-transitions plus illegal all-pairs covers the entire transition function
 * (for the rollout machine: 5 states × 6 events − 7 edges = 23 pairs, each owed a 409 +
 * state-unchanged by the service). Events are drawn from the machine's own edges, so the two
 * sets can never drift apart.
 */
export function illegalPairs(machine: AnyStateMachine): IllegalPair[] {
  const edges = allEdges(machine)
  const states = Object.keys(machine.config.states ?? {})
  const events = [...new Set(edges.map((e) => e.event))]
  const legal = new Set(edges.map((e) => `${e.from}|${e.event}`))
  return states.flatMap((state) =>
    events.filter((event) => !legal.has(`${state}|${event}`)).map((event) => ({ state, event })),
  )
}

/** Accumulates the edges a run actually crossed. The mutable sink is the point — like a span sink. */
export interface EdgeRecorder {
  record(edge: MachineEdge): void
  covered(): ReadonlySet<string>
}

export function edgeRecorder(): EdgeRecorder {
  const keys = new Set<string>()
  return {
    record(edge) {
      keys.add(edgeKey(edge))
    },
    covered() {
      return keys
    },
  }
}

/**
 * The edges a set of generated paths crosses. `GeneratedStep.state` is the
 * `JSON.stringify`-ed state VALUE (`'"Enabling"'`, not `'Enabling'` — generate-paths.ts),
 * so each step is `JSON.parse`d back to the plain name before keying; skipping that parse
 * makes path-edges and recorder-edges silently disjoint and every union wrong.
 */
export function edgesOfPaths(paths: readonly GeneratedPath[], initialState: string): Set<string> {
  const keys = new Set<string>()
  for (const path of paths) {
    let from = initialState
    for (const step of path.steps) {
      const to = JSON.parse(step.state) as string
      keys.add(edgeKey({ from, event: step.event, to }))
      from = to
    }
  }
  return keys
}

/** Coverage verdict in GraphWalker vocabulary: counts, percentage, and the gap left to drive. */
export interface EdgeCoverageReport {
  edges_total: number
  edges_covered: number
  edge_coverage_pct: number
  /** Declared edges no run has crossed yet — the deterministic gap-fill work list. */
  gap: MachineEdge[]
}

export function coverageReport(
  edges: readonly MachineEdge[],
  covered: ReadonlySet<string>,
): EdgeCoverageReport {
  const gap = edges.filter((edge) => !covered.has(edgeKey(edge)))
  const edgesCovered = edges.length - gap.length
  return {
    edges_total: edges.length,
    edges_covered: edgesCovered,
    edge_coverage_pct: edges.length === 0 ? 100 : Math.round((edgesCovered / edges.length) * 100),
    gap,
  }
}

/**
 * Drive `machine` through an ordered `events` sequence with a real XState actor, recording every
 * (from, event, to) transition it crosses into a fresh `EdgeRecorder`. This is the back-edge filler:
 * path generation reaches all states but misses cyclic edges, so a test hand-drives the remainder and
 * checks `coverageReport(allEdges(machine), recorder.covered())`. Shared so every flow-machine
 * conformance test uses one traversal helper instead of copy-pasting it.
 */
export function traverseAndRecord(
  machine: AnyStateMachine,
  events: readonly string[],
): EdgeRecorder {
  const recorder = edgeRecorder()
  const actor = createActor(machine).start()
  for (const event of events) {
    const from = String(actor.getSnapshot().value)
    actor.send({ type: event })
    recorder.record({ from, event, to: String(actor.getSnapshot().value) })
  }
  actor.stop()
  return recorder
}
