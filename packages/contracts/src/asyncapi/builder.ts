import {
  type JsonSchema,
  reachableSchemas,
  SCHEMA_REF_PREFIX,
  stringifyDoc,
} from '../registry-schema'

/**
 * Generic AsyncAPI 3.0 document assembler. Message payload schemas are sourced from Zod's
 * global registry (every `.meta({ id })` schema) via the shared `registry-schema` helpers, so
 * the one source of truth feeds BOTH contract documents (Commitment 3). Those helpers are pure
 * (output is a function of the registry + root ids), so the byte-sensitive OAS/Async round-trip
 * gates are unaffected by the sharing.
 */

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
  return stringifyDoc(doc)
}
