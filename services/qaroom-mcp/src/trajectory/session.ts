import type { Clock } from '@qaroom/determinism'
import { CONVENTIONS_TOOL_NAME } from '../registry/tools'
import type { McpToolDef, McpToolOutcome } from '../schema/mcp'
import type { McpCore } from '../server/core'
import {
  INITIAL_STATE,
  MACHINE,
  nextState,
  OFF_GRAPH_TRANSITION,
  type ToolTransition,
  type TrajectoryEvent,
} from './model'
import { emitToolTransitionSpan } from './span'

/**
 * The off-graph tool-call falsifier (Boundary 16, ADR-0032). This is the ONE place
 * `AGENT_OFF_GRAPH_TOOL_CALL` is read — at call time, so an externally-armed run
 * (`pnpm prove agent-trajectory-on-model --break`, the matrix sweep) is honored mid-process. It is
 * UNGUARDED and single-read: the detection-matrix census pins this exact site, and the demo platform
 * arms it operationally (never set on a real deployment), not behind a runtime predicate. Armed, the
 * session fires a read before discovering the catalogue — a transition outside the allowed graph — so
 * the reverse-conformance gate reds.
 */
function offGraphToolCallArmed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENT_OFF_GRAPH_TOOL_CALL === '1'
}

/** Map a tool name to the trajectory event invoking it drives (the conventions oracle vs a read). */
function eventForTool(name: string): TrajectoryEvent {
  return name === CONVENTIONS_TOOL_NAME ? 'InvokeConventions' : 'InvokeRead'
}

export interface McpSessionOptions {
  core: McpCore
  clock: Clock
  /** Defaults to the machine id (the development agent driving the surface). */
  agentId?: string
  /** The session handle — one agent run; non-empty so the identity oracle holds. */
  sessionId: string
}

/**
 * A thin model of an agent's tool-use SESSION over the read-first MCP surface — the TypeScript analog
 * of the moderator's trajectory (T21 documented this exact seam: "the SAME loop could drive
 * services/qaroom-mcp's callTool surface"). It drives the REAL `McpCore` (never a re-implementation),
 * and for each operation records a transition — stamped with `agent.id` / `session.id` — into its sink
 * and emits the matching `xstate.transition` span. The recorded trajectory is the input to
 * `checkTrajectory`: a healthy session stays on the allowed graph; the off-graph toggle injects the one
 * illegal edge the oracle must red on. Identity lives here, not in the core, because the core is
 * stateless per call — a session is the unit a trajectory is attributable to (mirrors graph.py's
 * `_advance`, which stamps identity in the workflow driver, not the individual nodes).
 */
export class McpSession {
  readonly #core: McpCore
  readonly #clock: Clock
  readonly #agentId: string
  readonly #sessionId: string
  #state: string = INITIAL_STATE
  readonly #transitions: ToolTransition[] = []

  constructor(options: McpSessionOptions) {
    this.#core = options.core
    this.#clock = options.clock
    this.#agentId = options.agentId ?? MACHINE
    this.#sessionId = options.sessionId
  }

  get transitions(): readonly ToolTransition[] {
    return this.#transitions
  }

  get state(): string {
    return this.#state
  }

  /** List the tool catalogue (MCP `tools/list`) — the discovery step the graph requires first. */
  discover(): McpToolDef[] {
    const tools = this.#core.listTools()
    this.#advance('Discover')
    return tools
  }

  /** Invoke a discovered tool by name and record the transition its kind drives. */
  async invoke(name: string, input: unknown): Promise<McpToolOutcome> {
    const outcome = await this.#core.callTool(name, input)
    this.#advance(eventForTool(name))
    return outcome
  }

  /**
   * The off-graph injection point — the analog of `dst_driver.inject_off_graph_tool_call`. When
   * `AGENT_OFF_GRAPH_TOOL_CALL` is armed, record a read invoked straight from `Start` (skipping
   * discovery) WITHOUT advancing the legal state; a no-op otherwise. The seeded harness calls this once
   * at the head of every run, so the fault seam is exercised on every trajectory.
   */
  maybeInjectOffGraphToolCall(): void {
    if (!offGraphToolCallArmed()) return
    this.#record(OFF_GRAPH_TRANSITION.from, OFF_GRAPH_TRANSITION.event, OFF_GRAPH_TRANSITION.to)
  }

  #advance(event: TrajectoryEvent): void {
    const from = this.#state
    const to = nextState(from, event)
    if (to === undefined) {
      // A genuine off-model emission from legitimate driving is itself a defect: record it as an
      // illegal self-edge so the oracle SURFACES it, rather than masking it (graph.py fails fast; the
      // observer records, so the trajectory remains inspectable).
      this.#record(from, event, from)
      return
    }
    this.#record(from, event, to)
    this.#state = to
  }

  #record(from: string, event: string, to: string): void {
    const transition: ToolTransition = {
      from,
      event,
      to,
      at: this.#clock.now().toISOString(),
      agent_id: this.#agentId,
      session_id: this.#sessionId,
    }
    emitToolTransitionSpan(transition)
    this.#transitions.push(transition)
  }
}
