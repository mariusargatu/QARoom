import { stringify } from 'yaml'
import { z } from 'zod'

/**
 * Generic AsyncAPI 3.0 document assembler. Message payload schemas are sourced from Zod's
 * global registry (every `.meta({ id })` schema), mirroring `openapi/builder.ts` so the one
 * source of truth feeds BOTH contract documents (Commitment 3). The registry-walk helpers
 * below intentionally mirror the OpenAPI builder's rather than share a module: the OAS gate
 * is byte-sensitive (a committed YAML round-trip), so the async path is kept independent so
 * a change here cannot perturb it.
 */

type JsonSchema = Record<string, unknown>
const SCHEMA_REF_PREFIX = '#/components/schemas/'

export interface AsyncInfo {
  title: string
  version: string
  description?: string
}

export interface AsyncServer {
  name: string
  host: string
  protocol: string
  description?: string
}

export interface AsyncChannel {
  /** Channel id, e.g. `postCreated`. */
  id: string
  /** Subject address in parameterized form, e.g. `qaroom.content.posts.{community_id}.created`. */
  address: string
  /** Operation id, e.g. `publishPostCreated`. */
  operationId: string
  /** `send` = this service publishes; `receive` = it subscribes. Direction drives the drift classifier. */
  action: 'send' | 'receive'
  /** Component message + schema id — the `<Entity><Verb>Event` schema's `.meta({ id })`. */
  messageName: string
  summary: string
  description: string
}

function emitRegistrySchemas(): Record<string, JsonSchema> {
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

/** Walk a schema and collect every component-schema id it `$ref`s. */
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

/** Emit only the schemas reachable from `rootIds` (their transitive `$ref` closure), sorted. */
function reachableSchemas(rootIds: readonly string[]): Record<string, JsonSchema> {
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

/**
 * Assemble an AsyncAPI 3.0 document from a set of channels. Each channel becomes a channel
 * (with a `community_id` parameter at the fixed third subject position), an operation
 * (`send`/`receive`), and a message whose payload `$ref`s the Zod-generated schema.
 */
export function buildAsyncApiDocument(
  info: AsyncInfo,
  channels: readonly AsyncChannel[],
  servers: readonly AsyncServer[] = [],
): JsonSchema {
  const channelsObj: Record<string, JsonSchema> = {}
  const operationsObj: Record<string, JsonSchema> = {}
  const messagesObj: Record<string, JsonSchema> = {}
  const roots: string[] = []

  for (const ch of channels) {
    channelsObj[ch.id] = {
      address: ch.address,
      parameters: {
        community_id: {
          description: 'The community (tenant) id at the fixed third subject position.',
        },
      },
      messages: { [ch.messageName]: { $ref: `#/components/messages/${ch.messageName}` } },
    }
    operationsObj[ch.operationId] = {
      action: ch.action,
      channel: { $ref: `#/channels/${ch.id}` },
      summary: ch.summary,
      description: ch.description,
      messages: [{ $ref: `#/channels/${ch.id}/messages/${ch.messageName}` }],
    }
    messagesObj[ch.messageName] = {
      name: ch.messageName,
      payload: { $ref: `${SCHEMA_REF_PREFIX}${ch.messageName}` },
    }
    roots.push(ch.messageName)
  }

  const doc: JsonSchema = {
    asyncapi: '3.0.0',
    info: {
      title: info.title,
      version: info.version,
      ...(info.description ? { description: info.description } : {}),
    },
  }
  if (servers.length > 0) {
    doc.servers = Object.fromEntries(
      servers.map((s) => [
        s.name,
        {
          host: s.host,
          protocol: s.protocol,
          ...(s.description ? { description: s.description } : {}),
        },
      ]),
    )
  }
  doc.channels = channelsObj
  doc.operations = operationsObj
  doc.components = { messages: messagesObj, schemas: reachableSchemas(roots) }
  return doc
}

/** Deterministic YAML serialization of an AsyncAPI document (stable key order, no anchors). */
export function stringifyAsyncApi(doc: JsonSchema): string {
  return stringify(doc, { sortMapEntries: false, lineWidth: 0, aliasDuplicateObjects: false })
}
