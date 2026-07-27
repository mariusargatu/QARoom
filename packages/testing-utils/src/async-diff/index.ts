import { diff } from '@asyncapi/diff'

/**
 * The QARoom AsyncAPI drift gate (ADR-0002). `@asyncapi/diff` is used purely as a
 * change-DETECTOR — its default ruleset marks genuinely breaking payload edits as
 * `unclassified` (the Milestone-0 spike finding) — and this module re-classifies each
 * detected change with explicit, DIRECTION-AWARE rules. Direction is load-bearing: the same
 * structural change flips breaking-ness between a producer (`send`) and a consumer
 * (`receive`), so the rule table is resolved per operation. This is the async mirror of the
 * `oasdiff` REST gate.
 */

export type AsyncApiDirection = 'send' | 'receive'

export interface AsyncChange {
  action: 'add' | 'remove' | 'edit'
  path: string
  before?: unknown
  after?: unknown
}

export interface Classification {
  classification: 'breaking' | 'nonBreaking'
  reason: string
}

export type ClassifiedAsyncChange = AsyncChange & Classification

type AsyncApiDoc = Record<string, unknown>

const breaking = (reason: string): Classification => ({ classification: 'breaking', reason })
const nonBreaking = (reason: string): Classification => ({ classification: 'nonBreaking', reason })

/**
 * Map a single detected change to breaking / nonBreaking, given the direction of the
 * message it touches. Pure — this is the rule table, contract-tested in `classifier.test.ts`.
 */
export function classifyAsyncChange(
  change: AsyncChange,
  direction: AsyncApiDirection,
): Classification {
  const { path, action } = change

  // A version bump is the SIGNAL of a change, not itself a breaking change.
  if (path === '/info/version') return nonBreaking('version metadata, not a payload change')

  // Channel-level add/remove: `/channels/<id>` with no deeper segment.
  if (/^\/channels\/[^/]+$/.test(path)) {
    return action === 'remove'
      ? breaking('channel removed, subscribers lose it')
      : nonBreaking('channel added')
  }

  // The channel ADDRESS is the NATS subject. Editing it silently orphans every consumer bound to
  // the old subject, which is the most breaking async change there is. The rule above only matches
  // `/channels/<id>` exactly, so this used to fall through to the permissive default.
  if (/^\/channels\/[^/]+\/address$/.test(path)) {
    return action === 'add'
      ? nonBreaking('address set on a new channel')
      : breaking('channel address changed, the NATS subject moved and consumers stop receiving')
  }

  // A payload property's `$ref` was retargeted. Every branded id in the generated specs is a
  // `$ref`, so the `/type` rule below can never match one, which is why the fixture pair (plain
  // `type: string`) looked green while the real specs were unguarded.
  if (/\/properties\/[^/]+\/\$ref$/.test(path)) {
    return action === 'edit'
      ? breaking('payload property $ref retargeted to a different schema')
      : nonBreaking('property $ref added or removed alongside its property')
  }

  // Validation constraints. Narrowing breaks producers and widening breaks consumers, and the
  // detector does not reliably tell us which, so any edit is treated as breaking. A deliberate
  // widening is a one-line justification in review, not a silent pass.
  if (
    /\/(maxLength|minLength|pattern|minimum|maximum|exclusiveMinimum|exclusiveMaximum|multipleOf|maxItems|minItems|format)$/.test(
      path,
    )
  ) {
    return action === 'add' || action === 'edit'
      ? breaking('payload constraint tightened or changed')
      : nonBreaking('payload constraint relaxed by removal')
  }

  // `enum` members. Removing one breaks receivers (a value they accepted is gone); adding one
  // breaks receivers too (they may not handle it) but is safe for senders.
  if (/\/enum(\/\d+)?$/.test(path)) {
    if (direction === 'receive') return breaking('enum membership changed for a received message')
    return action === 'remove'
      ? breaking('a sent message dropped an enum member consumers may still emit')
      : nonBreaking('a sent message gained an enum member')
  }

  // A payload property's type changed.
  if (/\/properties\/[^/]+\/type$/.test(path)) {
    return action === 'edit'
      ? breaking('payload property type changed')
      : nonBreaking('property type metadata')
  }

  // A payload property was added/removed.
  if (/\/properties\/[^/]+$/.test(path)) {
    return action === 'remove'
      ? breaking('payload property removed')
      : nonBreaking('payload property added')
  }

  // The `required` set changed — the one rule whose breaking-ness depends on direction.
  if (/\/required(\/\d+)?$/.test(path)) {
    if (direction === 'send') {
      return action === 'add'
        ? breaking('a sent message now requires a new field — producers must populate it')
        : nonBreaking('a sent message dropped a required field')
    }
    return action === 'remove'
      ? breaking('a received message lost a guaranteed field — consumers may depend on it')
      : nonBreaking('a received message gained a required field')
  }

  // Prose. LAST, so every structural rule above gets first refusal: a payload property named
  // `title` or `description` must be classified by the property rules, not mistaken for a doc
  // edit. Only what no structural rule claimed can be documentation. Needed at all because the
  // default below is now `breaking` — without it an ordinary doc edit would red the gate.
  if (/\/(description|summary|title|externalDocs|tags|examples?)$/.test(path)) {
    return nonBreaking('documentation only')
  }

  // FAIL CLOSED. This used to return nonBreaking, so every path the table did not recognise was
  // declared safe. Measured against the real services/content/asyncapi.yaml, that let a channel
  // address change, a retargeted property $ref, a narrowed maxLength and a removed enum member
  // all report zero breaking changes. An unrecognised change is now a finding: either add a rule
  // that says why it is safe, or treat it as breaking.
  return breaking(`unrecognized change at ${path} — no rule classifies it, so it is not assumed safe`)
}

interface RefObject {
  $ref?: string
}
interface OperationObject {
  action?: string
  channel?: RefObject
}
interface ChannelObject {
  messages?: Record<string, RefObject>
}
interface MessageComponent {
  payload?: RefObject
}

function refTail(ref: RefObject | undefined): string | undefined {
  return typeof ref?.$ref === 'string' ? ref.$ref.split('/').pop() : undefined
}

function asRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === 'object' ? (value as Record<string, T>) : {}
}

/** Resolve operations → channels → messages → payload schemas to learn each schema's direction. */
function directionBySchema(doc: AsyncApiDoc): Map<string, AsyncApiDirection> {
  const map = new Map<string, AsyncApiDirection>()
  const channels = asRecord<ChannelObject>(doc.channels)
  const operations = asRecord<OperationObject>(doc.operations)
  const components = asRecord<unknown>(doc.components)
  const messages = asRecord<MessageComponent>(components.messages)
  for (const op of Object.values(operations)) {
    const direction: AsyncApiDirection = op.action === 'receive' ? 'receive' : 'send'
    const channel = channels[refTail(op.channel) ?? '']
    for (const messageRef of Object.values(channel?.messages ?? {})) {
      const schemaName = refTail(messages[refTail(messageRef) ?? '']?.payload)
      if (schemaName) map.set(schemaName, direction)
    }
  }
  return map
}

/** A `/components/schemas/<Schema>/...` change inherits the direction of the schema it touches. */
function directionForPath(
  path: string,
  directions: Map<string, AsyncApiDirection>,
): AsyncApiDirection {
  const parts = path.split('/')
  if (parts[1] === 'components' && parts[2] === 'schemas') {
    return directions.get(parts[3] ?? '') ?? 'send'
  }
  return 'send'
}

function asChanges(changes: unknown): AsyncChange[] {
  return Array.isArray(changes) ? (changes as AsyncChange[]) : []
}

/**
 * Detect the breaking changes between two parsed AsyncAPI documents. `@asyncapi/diff`
 * detects; the QARoom rule table classifies (overriding the tool's own classification,
 * which the spike showed is direction-blind). Returns only the breaking changes — an empty
 * array means the revision is backward-compatible.
 */
export function asyncapiBreakingChanges(
  base: AsyncApiDoc,
  revision: AsyncApiDoc,
): ClassifiedAsyncChange[] {
  const output = diff(base, revision, { outputType: 'json' })
  const directions = directionBySchema(revision)
  for (const [schema, direction] of directionBySchema(base)) {
    if (!directions.has(schema)) directions.set(schema, direction)
  }
  const detected = [
    ...asChanges(output.breaking()),
    ...asChanges(output.nonBreaking()),
    ...asChanges(output.unclassified()),
  ]
  return detected
    .map((change) => ({
      ...change,
      ...classifyAsyncChange(change, directionForPath(change.path, directions)),
    }))
    .filter((change) => change.classification === 'breaking')
}
