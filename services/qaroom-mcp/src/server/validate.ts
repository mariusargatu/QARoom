import { Ajv, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

/**
 * Input validation against each tool's JSON Schema (the same `{ strict: false }` mode
 * the contract round-trip uses, because OpenAPI-3.0 schemas carry non-standard keywords).
 * Validators are compiled once per schema object and cached by reference.
 */
const ajv = new Ajv({ strict: false, allErrors: true })
addFormats(ajv)

const cache = new WeakMap<object, ValidateFunction>()

function compile(schema: Record<string, unknown>): ValidateFunction {
  const cached = cache.get(schema)
  if (cached) return cached
  const validate = ajv.compile(schema)
  cache.set(schema, validate)
  return validate
}

export interface InputValidation {
  ok: boolean
  errors: string[]
}

export function validateToolInput(
  schema: Record<string, unknown>,
  input: unknown,
): InputValidation {
  const validate = compile(schema)
  const ok = validate(input) === true
  const errors = (validate.errors ?? []).map(
    (error) => `${error.instancePath || '(root)'} ${error.message ?? 'is invalid'}`,
  )
  return { ok, errors }
}
