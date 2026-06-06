import { stringify } from 'yaml'
import { z } from 'zod'

/**
 * Shared registry-walk + serialization helpers for the OpenAPI and AsyncAPI builders. Both
 * documents source `components.schemas` from Zod's global registry (every `.meta({ id })` schema)
 * — the single source of truth (Commitment 3) — so the walk is identical. Kept PURE: the output is
 * a function of the registry + root ids only, so the byte-sensitive OAS/Async drift gates see no
 * change versus the previously duplicated per-builder copies (verified by the golden round-trip).
 */

export type JsonSchema = Record<string, unknown>
export const SCHEMA_REF_PREFIX = '#/components/schemas/'

/** Every registered schema as OpenAPI-3.0 JSON Schema, `$id` stripped (the ref carries identity). */
export function emitRegistrySchemas(): Record<string, JsonSchema> {
  const emitted = z.toJSONSchema(z.globalRegistry, {
    target: 'openapi-3.0',
    uri: (id: string) => `${SCHEMA_REF_PREFIX}${id}`,
  }) as { schemas: Record<string, JsonSchema> }
  const schemas: Record<string, JsonSchema> = {}
  for (const [id, schema] of Object.entries(emitted.schemas)) {
    const copy: JsonSchema = { ...schema }
    delete copy.$id
    schemas[id] = copy
  }
  return schemas
}

/** Walk a schema and collect every component-schema id it `$ref`s (the transitive closure's edges). */
export function findRefs(node: unknown, ids: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) findRefs(item, ids)
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith(SCHEMA_REF_PREFIX)) {
        ids.push(value.slice(SCHEMA_REF_PREFIX.length))
      } else findRefs(value, ids)
    }
  }
  return ids
}

/** Emit only the schemas reachable from `rootIds` (their transitive `$ref` closure), sorted. */
export function reachableSchemas(rootIds: readonly string[]): Record<string, JsonSchema> {
  const all = emitRegistrySchemas()
  const queue = [...rootIds]
  const reachable = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined || reachable.has(id)) continue
    reachable.add(id)
    const schema = all[id]
    if (schema) queue.push(...findRefs(schema))
  }
  const schemas: Record<string, JsonSchema> = {}
  for (const id of [...reachable].sort()) {
    const schema = all[id]
    if (schema) schemas[id] = schema
  }
  return schemas
}

/** Deterministic YAML serialization of a contract document (stable key order, no anchors). */
export function stringifyDoc(doc: JsonSchema): string {
  return stringify(doc, { sortMapEntries: false, lineWidth: 0, aliasDuplicateObjects: false })
}
