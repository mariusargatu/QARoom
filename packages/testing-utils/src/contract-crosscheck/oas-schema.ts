/**
 * Turn an OpenAPI 3.0 schema into something Ajv (JSON Schema draft-07) validates correctly, and
 * express the one asymmetry between a Pact request and a Pact response.
 *
 * ## Why a dialect conversion is needed
 *
 * OAS 3.0 is *not* JSON Schema. It uses the draft-04 spelling of exclusive bounds
 * (`minimum: 0` + `exclusiveMinimum: true`) and its own `nullable: true`. Ajv reads draft-07,
 * where `exclusiveMinimum` must be a NUMBER — handed the boolean it throws
 * `schema is invalid: .../exclusiveMinimum must be number` and the cross-check dies rather than
 * reporting a contract verdict. Live in donations (2), gateway (6), webhooks (2), identity (1);
 * it went unnoticed only because the two services that had a cross-check happened to have none.
 *
 * ## Why `required` is enforced on requests but not responses
 *
 * A Pact REQUEST body is literally what the consumer transmits, so a missing required property is
 * real drift. A Pact RESPONSE body is a PROJECTION — the consumer pins only the fields it actually
 * consumes and the provider is free to send more. Enforcing `required` there marks correct Pact
 * usage as a violation: gateway's donations 404 pins `{type,title,status,retryable,failure_domain}`
 * and omits `next_actions`, which `makeProblem` always sends (defaulted to `[]`). The provider is
 * right, the consumer is right, and a naive check calls it a bug.
 *
 * What the response half still enforces: every property the pact DOES pin must exist in the schema
 * (`additionalProperties: false` still bites) and must have the right type. That is the drift worth
 * catching — a renamed or retyped field — without punishing under-specification.
 */
type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface NormalizeOptions {
  /**
   * Drop every `required` array. Use for RESPONSE bodies, where the pact is a subset projection.
   * Leave false for REQUEST bodies, which are the complete payload the consumer sends.
   */
  relaxRequired: boolean
}

/**
 * Deep-convert an OAS 3.0 schema to draft-07. `SwaggerParser.dereference` inlines `$ref`s, which
 * makes a recursive schema CIRCULAR — so nodes are memoized and revisits short-circuit, or this
 * would recurse until the stack blows.
 */
export function toJsonSchema(schema: object, opts: NormalizeOptions): object {
  const seen = new Map<object, unknown>()

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const cached = seen.get(node)
      if (cached !== undefined) return cached
      const out: unknown[] = []
      seen.set(node, out)
      for (const item of node) out.push(walk(item))
      return out
    }
    if (!isObject(node)) return node

    const cached = seen.get(node)
    if (cached !== undefined) return cached
    const out: Json = {}
    seen.set(node, out)

    for (const [key, value] of Object.entries(node)) {
      // Handled below, after the copy, so the numeric rewrite cannot be clobbered.
      if (key === 'exclusiveMinimum' || key === 'exclusiveMaximum') continue
      if (key === 'nullable') continue
      if (key === 'required' && opts.relaxRequired && Array.isArray(value)) continue
      out[key] = walk(value)
    }

    // draft-04 booleans → draft-07 numbers. `exclusiveMinimum: true` means "the sibling `minimum`
    // is exclusive", so the bound MOVES onto the exclusive keyword and the inclusive one goes.
    for (const [flag, bound] of [
      ['exclusiveMinimum', 'minimum'],
      ['exclusiveMaximum', 'maximum'],
    ] as const) {
      const value = node[flag]
      if (typeof value === 'number') {
        out[flag] = value
      } else if (value === true && typeof node[bound] === 'number') {
        out[flag] = node[bound]
        delete out[bound]
      }
      // `exclusiveMinimum: false` is the default (inclusive) — dropping it leaves `minimum` intact.
    }

    // OAS `nullable: true` widens the declared type; draft-07 spells that as a type union.
    if (node.nullable === true && typeof out.type === 'string') {
      out.type = [out.type, 'null']
    }

    return out
  }

  return walk(schema) as object
}
