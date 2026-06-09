import { ulidArb } from '@qaroom/testing-utils/generators'
import fc from 'fast-check'

/**
 * Schema-driven fast-check arbitraries: given a tool's MCP input_schema, produce inputs
 * that satisfy it (using the repo's branded-ID generators) or deliberately violate it.
 * This is what makes the Gate-4 property tests range over the JSON Schema itself.
 */
interface JsonSchemaNode {
  type?: string
  pattern?: string
  minimum?: number
}

function brandedArb(prefix: string): fc.Arbitrary<string> {
  return ulidArb.map((ulid) => `${prefix}_${ulid}`)
}

function propArb(schema: unknown): fc.Arbitrary<unknown> {
  const node = schema as JsonSchemaNode
  if (node.type === 'integer') return fc.integer({ min: node.minimum ?? 0, max: 1000 })
  if (node.pattern?.startsWith('^post_')) return brandedArb('post')
  if (node.pattern?.startsWith('^comm_')) return brandedArb('comm')
  if (node.pattern?.startsWith('^dntn_')) return brandedArb('dntn')
  if (node.pattern?.startsWith('^whsub_')) return brandedArb('whsub')
  if (node.pattern?.startsWith('^user_')) return brandedArb('user')
  if (node.pattern?.startsWith('^mdec_')) return brandedArb('mdec')
  if (node.pattern === '^[a-z][a-z0-9-]{1,63}$') {
    return fc.constantFrom('donations', 'new-feature', 'beta-mode')
  }
  return fc.string({ minLength: 1 })
}

export function validInputArb(
  inputSchema: Record<string, unknown>,
): fc.Arbitrary<Record<string, unknown>> {
  const properties = (inputSchema.properties ?? {}) as Record<string, unknown>
  const required = (inputSchema.required ?? []) as string[]
  // Generate every property; `requiredKeys` keeps the required ones always present and includes
  // the optional ones probabilistically — so optional fields (e.g. listEvents.after) get exercised.
  const shape: Record<string, fc.Arbitrary<unknown>> = {}
  for (const [name, schema] of Object.entries(properties)) shape[name] = propArb(schema)
  return fc.record(shape, { requiredKeys: required })
}

/** A valid input with one unexpected field — rejected by `additionalProperties: false`. */
export function invalidExtraFieldArb(
  inputSchema: Record<string, unknown>,
): fc.Arbitrary<Record<string, unknown>> {
  return validInputArb(inputSchema).map((valid) => ({ ...valid, __unexpected__: 'x' }))
}
