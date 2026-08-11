import { Ajv } from 'ajv'
import { describe, expect, it } from 'vitest'
import { toJsonSchema } from './oas-schema'

/**
 * The OAS-3.0 → draft-07 conversion the cross-check compiles through. Every case here is a shape
 * that live in a committed QARoom spec (donations/gateway/webhooks/identity all carry
 * `exclusiveMinimum: true`), and each one either CRASHED Ajv or silently mis-validated before.
 */
const compile = (schema: object, relaxRequired = false) =>
  new Ajv({ strict: false, allErrors: true }).compile(toJsonSchema(schema, { relaxRequired }))

describe('toJsonSchema converts the OAS 3.0 dialect Ajv cannot read', () => {
  // The exact shape in services/donations/openapi.yaml — Ajv threw
  // "schema is invalid: .../exclusiveMinimum must be number" and killed the cross-check outright.
  const amount = {
    type: 'object',
    properties: { amount_cents: { type: 'integer', minimum: 0, exclusiveMinimum: true } },
  }

  it('compiles a draft-04 boolean exclusiveMinimum instead of throwing', () => {
    expect(() => compile(amount)).not.toThrow()
  })

  it('preserves the bound as EXCLUSIVE (0 rejected, 1 accepted)', () => {
    const validate = compile(amount)
    expect(validate({ amount_cents: 0 })).toBe(false)
    expect(validate({ amount_cents: 1 })).toBe(true)
  })

  it('leaves an already-numeric exclusiveMinimum alone', () => {
    const validate = compile({ type: 'integer', exclusiveMinimum: 5 })
    expect(validate(5)).toBe(false)
    expect(validate(6)).toBe(true)
  })

  it('keeps the bound INCLUSIVE when exclusiveMinimum is false', () => {
    const validate = compile({ type: 'integer', minimum: 0, exclusiveMinimum: false })
    expect(validate(0)).toBe(true)
  })

  it('converts exclusiveMaximum the same way', () => {
    const validate = compile({ type: 'integer', maximum: 10, exclusiveMaximum: true })
    expect(validate(10)).toBe(false)
    expect(validate(9)).toBe(true)
  })

  it('widens a nullable type into a draft-07 union', () => {
    const validate = compile({ type: 'string', nullable: true })
    expect(validate(null)).toBe(true)
    expect(validate('x')).toBe(true)
    expect(validate(1)).toBe(false)
  })
})

describe('toJsonSchema expresses the request/response required asymmetry', () => {
  const problem = {
    type: 'object',
    required: ['type', 'next_actions'],
    properties: { type: { type: 'string' }, next_actions: { type: 'array' } },
  }

  // gateway's donations 404 pins {type,...} and omits next_actions, which makeProblem always sends.
  // Enforcing `required` on a response pact marks that correct under-specification as drift.
  it('relaxed: a response pact may omit a required field it does not consume', () => {
    expect(compile(problem, true)({ type: 'https://qaroom.dev/errors/x' })).toBe(true)
  })

  it('strict: a request pact omitting a required field is drift', () => {
    expect(compile(problem, false)({ type: 'https://qaroom.dev/errors/x' })).toBe(false)
  })

  // Relaxing `required` must not relax anything else, or the response half stops catching the
  // drift it exists for — a renamed or retyped field.
  it('relaxed still rejects a field the schema forbids', () => {
    const strictObject = {
      type: 'object',
      required: ['a'],
      additionalProperties: false,
      properties: { a: { type: 'string' } },
    }
    expect(compile(strictObject, true)({ b: 'renamed' })).toBe(false)
  })

  it('relaxed still rejects a field of the wrong type', () => {
    expect(compile(problem, true)({ type: 42 })).toBe(false)
  })
})

describe('toJsonSchema survives the structures dereferencing produces', () => {
  // SwaggerParser.dereference inlines $refs, so a self-referential schema becomes a CYCLE. A naive
  // deep copy recurses until the stack blows — which would surface as a crash, not a verdict.
  it('terminates on a circular schema', () => {
    const node: Record<string, unknown> = { type: 'object', properties: {} }
    ;(node.properties as Record<string, unknown>).child = node
    expect(() => toJsonSchema(node, { relaxRequired: false })).not.toThrow()
  })

  it('does not mutate the schema it was given', () => {
    const original = { type: 'integer', minimum: 0, exclusiveMinimum: true }
    toJsonSchema(original, { relaxRequired: true })
    expect(original).toEqual({ type: 'integer', minimum: 0, exclusiveMinimum: true })
  })
})
