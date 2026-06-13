import type { OasOperation } from '@qaroom/contracts'
import type { ConventionsInput } from '../conventions/oracle'

/** Substitute path params and collect query params from validated tool input. */
export function resolveRequest(
  op: OasOperation,
  input: Record<string, unknown>,
): { path: string; query: Record<string, string | number> } {
  let path = op.path
  const query: Record<string, string | number> = {}
  for (const param of op.params ?? []) {
    const value = input[param.name]
    if (value === undefined) continue
    if (param.in === 'path') {
      path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)))
    } else if (param.in === 'query') {
      query[param.name] = typeof value === 'number' ? value : String(value)
    }
    // header params (e.g. Idempotency-Key) belong to the deferred mutating surface.
  }
  return { path, query }
}

/** Narrow validated conventions-tool input (already AJV-checked) to a typed shape. */
export function asConventionsInput(input: unknown): ConventionsInput {
  const obj = input as { code?: unknown; filename?: unknown; rules?: unknown }
  return {
    code: typeof obj.code === 'string' ? obj.code : '',
    filename: typeof obj.filename === 'string' ? obj.filename : undefined,
    rules: Array.isArray(obj.rules)
      ? obj.rules.filter((rule): rule is string => typeof rule === 'string')
      : undefined,
  }
}
