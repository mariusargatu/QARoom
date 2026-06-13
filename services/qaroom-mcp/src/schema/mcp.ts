import { ProblemDetails } from '@qaroom/contracts'
import { z } from 'zod'

/**
 * The MCP server's own contracts. These are typed artifacts — never `toMatchSnapshot`
 * blobs (ADR-0006). The manifest is the frozen, drift-gated tool catalogue; the tool
 * outcome and conventions verdict are the validated shapes every transport returns.
 */

/** One tool in the catalogue, derived from a service operation (read-first v1). */
export const McpToolDef = z
  .object({
    name: z.string(),
    service: z.string(),
    operation_id: z.string(),
    method: z.string(),
    path: z.string(),
    mutating: z.boolean(),
    title: z.string(),
    description: z.string(),
    /** MCP-tool-shaped JSON Schema — identical to the operation's `/system/capabilities` input_schema. */
    input_schema: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'McpToolDef', description: 'One MCP tool derived from a service operation.' })
export type McpToolDef = z.infer<typeof McpToolDef>

/** One read resource (state / limits / test-results). */
export const McpResourceDef = z
  .object({
    uri: z.string(),
    name: z.string(),
    description: z.string(),
    mime_type: z.string(),
  })
  .meta({ id: 'McpResourceDef', description: 'One MCP read resource.' })
export type McpResourceDef = z.infer<typeof McpResourceDef>

/**
 * The frozen tool manifest (Gate 1). Carries NO wall-clock or snapshot field, so a
 * regenerate-and-diff is byte-stable: any change is an intentional contract change.
 */
export const McpManifest = z
  .object({
    protocol_version: z.string(),
    server: z.object({ name: z.string(), version: z.string() }),
    tools: z.array(McpToolDef),
    resources: z.array(McpResourceDef),
  })
  .meta({ id: 'McpManifest', description: 'Frozen MCP tool + resource catalogue (drift-gated).' })
export type McpManifest = z.infer<typeof McpManifest>

/** A successful tool call. `request_id` + `served_at` come from the injected IdGenerator + Clock. */
export const McpToolSuccess = z
  .object({
    ok: z.literal(true),
    tool: z.string(),
    request_id: z.string(),
    served_at: z.iso.datetime(),
    status: z.number().int(),
    content: z.unknown(),
  })
  .meta({ id: 'McpToolSuccess' })
export type McpToolSuccess = z.infer<typeof McpToolSuccess>

/** A failed tool call — the failure IS an RFC 7807 ProblemDetails (Gate 2). */
export const McpToolError = z
  .object({
    ok: z.literal(false),
    tool: z.string(),
    request_id: z.string(),
    served_at: z.iso.datetime(),
    problem: ProblemDetails,
  })
  .meta({ id: 'McpToolError' })
export type McpToolError = z.infer<typeof McpToolError>

export const McpToolOutcome = z.discriminatedUnion('ok', [McpToolSuccess, McpToolError])
export type McpToolOutcome = z.infer<typeof McpToolOutcome>

/** A successful resource read. The content is the upstream's validated body. */
export const McpResourceSuccess = z
  .object({
    ok: z.literal(true),
    uri: z.string(),
    request_id: z.string(),
    served_at: z.iso.datetime(),
    content: z.unknown(),
  })
  .meta({ id: 'McpResourceSuccess' })
export type McpResourceSuccess = z.infer<typeof McpResourceSuccess>

export const McpResourceError = z
  .object({
    ok: z.literal(false),
    uri: z.string(),
    request_id: z.string(),
    served_at: z.iso.datetime(),
    problem: ProblemDetails,
  })
  .meta({ id: 'McpResourceError' })
export type McpResourceError = z.infer<typeof McpResourceError>

export const McpResourceOutcome = z.discriminatedUnion('ok', [McpResourceSuccess, McpResourceError])
export type McpResourceOutcome = z.infer<typeof McpResourceOutcome>

export const ConventionViolation = z.object({
  rule: z.string(),
  message: z.string(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
})
export type ConventionViolation = z.infer<typeof ConventionViolation>

/** The conventions-oracle verdict: a typed answer, callable before writing code. */
export const ConventionsVerdict = z
  .object({
    ok: z.boolean(),
    checked_rules: z.array(z.string()),
    violations: z.array(ConventionViolation),
  })
  .meta({ id: 'McpConventionsVerdict' })
export type ConventionsVerdict = z.infer<typeof ConventionsVerdict>
