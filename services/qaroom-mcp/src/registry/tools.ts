import { OPERATIONS as CONTENT_OPS } from '@qaroom/content/operations'
import type { OasOperation } from '@qaroom/contracts'
import { OPERATIONS as GATEWAY_OPS } from '@qaroom/gateway/operations'
import { operationInputSchema } from '@qaroom/service-kit'
import type { McpToolDef } from '../schema/mcp'

/**
 * The tool catalogue is generated from the contract-verified operation registries —
 * never hand-maintained (ADR-0006). Adding a service GET auto-adds a tool. Read-first
 * v1: only non-mutating, non-`/system/*` operations become callable tools; the
 * `/system/*` reads are surfaced as resources instead.
 */
export interface ToolEntry {
  def: McpToolDef
  op: OasOperation | null
  service: string
  kind: 'proxy' | 'conventions'
}

const SYSTEM_PATH_PREFIX = '/system/'

function isExposedRead(op: OasOperation): boolean {
  return !op.mutating && !op.path.startsWith(SYSTEM_PATH_PREFIX)
}

function toolName(service: string, operationId: string): string {
  return `${service}_${operationId}`
}

function compareNames(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function proxyEntry(service: string, op: OasOperation): ToolEntry {
  return {
    def: {
      name: toolName(service, op.operationId),
      service,
      operation_id: op.operationId,
      method: op.method.toUpperCase(),
      path: op.path,
      mutating: op.mutating,
      title: op.summary,
      description: op.description,
      input_schema: operationInputSchema(op),
    },
    op,
    service,
    kind: 'proxy',
  }
}

const SERVICE_REGISTRIES: ReadonlyArray<{
  service: string
  operations: readonly OasOperation[]
}> = [
  { service: 'content', operations: CONTENT_OPS },
  { service: 'gateway', operations: GATEWAY_OPS },
]

export const CONVENTIONS_TOOL_NAME = 'qaroom_conventionsCheck'

const CONVENTIONS_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      maxLength: 100000,
      description: 'The TypeScript source snippet to check (≤100k chars).',
    },
    filename: {
      type: 'string',
      description:
        'Path the snippet would live at; selects file-scoped conventions (e.g. *.test.ts).',
    },
    rules: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional subset of rule ids; omit to run the snippet-checkable default set.',
    },
  },
  required: ['code'],
  additionalProperties: false,
}

function conventionsEntry(): ToolEntry {
  return {
    def: {
      name: CONVENTIONS_TOOL_NAME,
      service: 'qaroom',
      operation_id: 'conventionsCheck',
      method: 'POST',
      path: '/conventions/check',
      mutating: false,
      title: 'Check a snippet against enforced conventions',
      description:
        'Runs eslint-plugin-qaroom over a snippet and returns a typed verdict — callable before writing code so an agent can self-check determinism/test-shape rules.',
      input_schema: CONVENTIONS_INPUT_SCHEMA,
    },
    op: null,
    service: 'qaroom',
    kind: 'conventions',
  }
}

/** The read-first v1 catalogue: every exposed GET across content + gateway, plus the oracle. */
export function buildToolEntries(): ToolEntry[] {
  const proxies = SERVICE_REGISTRIES.flatMap(({ service, operations }) =>
    operations.filter(isExposedRead).map((op) => proxyEntry(service, op)),
  )
  return [...proxies, conventionsEntry()].sort((a, b) => compareNames(a.def.name, b.def.name))
}
