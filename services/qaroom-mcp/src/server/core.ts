import type { ConventionsOracle } from '../conventions/oracle'
import { createConventionsOracle } from '../conventions/oracle'
import type { McpDeps, ServiceClient } from '../deps'
import { buildResourceEntries, type ResourceEntry } from '../registry/resources'
import { buildToolEntries, type ToolEntry } from '../registry/tools'
import {
  ConventionsVerdict,
  type McpResourceDef,
  type McpResourceError,
  type McpResourceOutcome,
  type McpResourceSuccess,
  type McpToolDef,
  type McpToolError,
  type McpToolOutcome,
  type McpToolSuccess,
} from '../schema/mcp'
import {
  dependencyFailureProblem,
  internalToolProblem,
  invalidToolInputProblem,
  resourceNotFoundProblem,
  toolNotFoundProblem,
  upstreamProblem,
} from './errors'
import { asConventionsInput, resolveRequest } from './request'
import type { SummaryProvider } from './summary-provider'
import { validateToolInput } from './validate'

export interface McpCoreOptions {
  deps: McpDeps
  services: ServiceClient
  summary: SummaryProvider
  oracle?: ConventionsOracle
}

/**
 * The transport-agnostic MCP server core (ADR-0006). Holds no database; its only edge
 * is the ServiceClient. Every outcome is stamped with a `request_id` (IdGenerator) and
 * `served_at` (Clock) from the injected deps — which is exactly what makes the Gate-3
 * golden transcript byte-stable.
 */
export class McpCore {
  readonly #deps: McpDeps
  readonly #services: ServiceClient
  readonly #summary: SummaryProvider
  readonly #oracle: ConventionsOracle
  readonly #tools: ToolEntry[]
  readonly #resources: readonly ResourceEntry[]
  readonly #toolsByName: Map<string, ToolEntry>
  readonly #resourcesByUri: Map<string, ResourceEntry>

  constructor(options: McpCoreOptions) {
    this.#deps = options.deps
    this.#services = options.services
    this.#summary = options.summary
    this.#oracle = options.oracle ?? createConventionsOracle()
    this.#tools = buildToolEntries()
    this.#resources = buildResourceEntries()
    this.#toolsByName = new Map(this.#tools.map((entry) => [entry.def.name, entry]))
    this.#resourcesByUri = new Map(this.#resources.map((entry) => [entry.def.uri, entry]))
  }

  listTools(): McpToolDef[] {
    return this.#tools.map((entry) => entry.def)
  }

  listResources(): McpResourceDef[] {
    return this.#resources.map((entry) => entry.def)
  }

  async callTool(name: string, input: unknown): Promise<McpToolOutcome> {
    const request_id = this.#deps.ids.next('mcpreq')
    const served_at = this.#deps.clock.now().toISOString()

    const entry = this.#toolsByName.get(name)
    if (!entry) return toolError(name, request_id, served_at, toolNotFoundProblem(name))

    const validation = validateToolInput(entry.def.input_schema, input)
    if (!validation.ok) {
      return toolError(
        name,
        request_id,
        served_at,
        invalidToolInputProblem(name, validation.errors.join('; ')),
      )
    }

    if (entry.kind === 'conventions') {
      const verdict = ConventionsVerdict.parse(this.#oracle.check(asConventionsInput(input)))
      return toolSuccess(name, request_id, served_at, 200, verdict)
    }

    return this.#callProxy(entry, input, request_id, served_at)
  }

  async #callProxy(
    entry: ToolEntry,
    input: unknown,
    request_id: string,
    served_at: string,
  ): Promise<McpToolOutcome> {
    const op = entry.op
    if (!op) {
      return toolError(
        entry.def.name,
        request_id,
        served_at,
        internalToolProblem(entry.def.name, 'no operation bound'),
      )
    }
    const { path, query } = resolveRequest(op, input as Record<string, unknown>)
    const response = await this.#safeGet(entry.service, path, query)
    if (response === null) {
      return toolError(
        entry.def.name,
        request_id,
        served_at,
        dependencyFailureProblem(entry.service, 'request failed'),
      )
    }
    if (response.status >= 400) {
      return toolError(
        entry.def.name,
        request_id,
        served_at,
        upstreamProblem(entry.service, response),
      )
    }
    return toolSuccess(entry.def.name, request_id, served_at, response.status, response.body)
  }

  async readResource(uri: string): Promise<McpResourceOutcome> {
    const request_id = this.#deps.ids.next('mcpres')
    const served_at = this.#deps.clock.now().toISOString()

    const entry = this.#resourcesByUri.get(uri)
    if (!entry) return resourceError(uri, request_id, served_at, resourceNotFoundProblem(uri))

    if (entry.kind === 'test-results') {
      const summary = this.#summary.read()
      if (summary === null) {
        return resourceError(uri, request_id, served_at, resourceNotFoundProblem(uri))
      }
      return resourceSuccess(uri, request_id, served_at, summary)
    }

    const service = entry.service ?? 'gateway'
    const response = await this.#safeGet(service, entry.path ?? '/system/state')
    if (response === null) {
      return resourceError(
        uri,
        request_id,
        served_at,
        dependencyFailureProblem(service, 'request failed'),
      )
    }
    if (response.status >= 400) {
      return resourceError(uri, request_id, served_at, upstreamProblem(service, response))
    }
    return resourceSuccess(uri, request_id, served_at, response.body)
  }

  async #safeGet(service: string, path: string, query?: Record<string, string | number>) {
    return this.#services.get(service, path, query).catch(() => null)
  }
}

function toolSuccess(
  tool: string,
  request_id: string,
  served_at: string,
  status: number,
  content: unknown,
): McpToolSuccess {
  return { ok: true, tool, request_id, served_at, status, content }
}

function toolError(
  tool: string,
  request_id: string,
  served_at: string,
  problem: McpToolError['problem'],
): McpToolError {
  return { ok: false, tool, request_id, served_at, problem }
}

function resourceSuccess(
  uri: string,
  request_id: string,
  served_at: string,
  content: unknown,
): McpResourceSuccess {
  return { ok: true, uri, request_id, served_at, content }
}

function resourceError(
  uri: string,
  request_id: string,
  served_at: string,
  problem: McpResourceError['problem'],
): McpResourceError {
  return { ok: false, uri, request_id, served_at, problem }
}
