import { stringify } from 'yaml'
import { z } from 'zod'

/**
 * Generic OpenAPI 3.0 document assembler. Schemas are sourced from Zod's global
 * registry (every `.meta({ id })` schema), so `components.schemas` is generated
 * from the single source of truth (Commitment 3). Operations are supplied by the
 * service that owns them. This builder contains NO content-service knowledge.
 */

type JsonSchema = Record<string, unknown>

export interface OasParam {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  description: string
  schema: JsonSchema
}

export interface OasResponse {
  code: number
  description: string
  /** Component id (`#/components/schemas/<bodyRef>`). Omit for empty bodies. */
  bodyRef?: string
  /** Defaults to `application/json`; error responses use `application/problem+json`. */
  contentType?: string
  example?: unknown
  /** OAS `links` object. Mutating endpoints must declare at least one (docs/05 L122). */
  links?: Record<string, unknown>
}

export interface OasOperation {
  operationId: string
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  path: string
  summary: string
  description: string
  tags?: string[]
  mutating: boolean
  params?: OasParam[]
  requestBodyRef?: string
  requestExample?: unknown
  responses: OasResponse[]
}

export interface OasInfo {
  title: string
  version: string
  description?: string
}

export interface OasServer {
  url: string
  description?: string
}

export function schemaRef(id: string): JsonSchema {
  return { $ref: `#/components/schemas/${id}` }
}

function emitRegistrySchemas(): Record<string, JsonSchema> {
  const emitted = z.toJSONSchema(z.globalRegistry, {
    target: 'openapi-3.0',
    uri: (id: string) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, JsonSchema> }

  const schemas: Record<string, JsonSchema> = {}
  for (const [id, schema] of Object.entries(emitted.schemas)) {
    const copy: JsonSchema = { ...schema }
    delete copy.$id
    schemas[id] = copy
  }
  return schemas
}

function buildResponses(op: OasOperation): Record<string, JsonSchema> {
  const responses: Record<string, JsonSchema> = {}
  for (const r of op.responses) {
    const contentType = r.contentType ?? 'application/json'
    const entry: JsonSchema = { description: r.description }
    if (r.bodyRef) {
      const media: JsonSchema = { schema: schemaRef(r.bodyRef) }
      if (r.example !== undefined) media.example = r.example
      entry.content = { [contentType]: media }
    }
    if (r.links) entry.links = r.links
    responses[String(r.code)] = entry
  }
  return responses
}

function buildOperation(op: OasOperation): JsonSchema {
  const operation: JsonSchema = {
    operationId: op.operationId,
    summary: op.summary,
    description: op.description,
    responses: buildResponses(op),
  }
  if (op.tags) operation.tags = op.tags
  if (op.params && op.params.length > 0) {
    operation.parameters = op.params.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      description: p.description,
      schema: p.schema,
    }))
  }
  if (op.requestBodyRef) {
    const media: JsonSchema = { schema: schemaRef(op.requestBodyRef) }
    if (op.requestExample !== undefined) media.example = op.requestExample
    operation.requestBody = { required: true, content: { 'application/json': media } }
  }
  return operation
}

const SCHEMA_REF_PREFIX = '#/components/schemas/'

/** Walk a schema and collect every component-schema id it `$ref`s (the transitive closure's edges). */
function findRefs(node: unknown, ids: string[] = []): string[] {
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

/**
 * Emit only the component schemas reachable from `operations` (the request/response
 * body refs and their transitive `$ref` closure), sorted for deterministic output.
 * This keeps each service's document self-contained — a schema another service
 * registers in the shared global registry does not leak into this one's OAS.
 */
function reachableSchemas(operations: readonly OasOperation[]): Record<string, JsonSchema> {
  const all = emitRegistrySchemas()
  const queue: string[] = []
  for (const op of operations) {
    if (op.requestBodyRef) queue.push(op.requestBodyRef)
    for (const r of op.responses) {
      if (r.bodyRef) queue.push(r.bodyRef)
    }
  }

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

export function buildOpenApiDocument(
  info: OasInfo,
  operations: readonly OasOperation[],
  servers: readonly OasServer[] = [],
): JsonSchema {
  const paths: Record<string, JsonSchema> = {}
  for (const op of operations) {
    const pathItem = paths[op.path] ?? {}
    pathItem[op.method] = buildOperation(op)
    paths[op.path] = pathItem
  }

  const doc: JsonSchema = {
    openapi: '3.0.3',
    info: {
      title: info.title,
      version: info.version,
      ...(info.description ? { description: info.description } : {}),
    },
    paths,
    components: { schemas: reachableSchemas(operations) },
  }
  if (servers.length > 0) doc.servers = servers
  return doc
}

/** Deterministic YAML serialization of an OpenAPI document (stable key order, no anchors). */
export function stringifyOpenApi(doc: JsonSchema): string {
  return stringify(doc, { sortMapEntries: false, lineWidth: 0, aliasDuplicateObjects: false })
}
