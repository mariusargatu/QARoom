import { MatchersV3 } from '@pact-foundation/pact'
import { readEventHeaders } from '@qaroom/messaging'
import { expect } from 'vitest'
import { classifyEventType } from '../../src/consumer'

/**
 * The shape every webhooks fan-out message contract shares.
 *
 * webhooks binds five feed subjects and consumes all of them the SAME way: it routes on the
 * `event-name` header, scopes on `tenant.id`, dedups on `Nats-Msg-Id`, and forwards the body to the
 * subscriber untouched. Re-stating that in each per-provider spec would be four copies of one
 * expectation, and the copies would drift — so the metadata block and the handler live here once,
 * and each spec supplies only what is genuinely provider-specific: the event name and the body.
 *
 * Not a `.spec.ts`, so `pact:drift`'s `vitest run tests/contracts` treats it as a module rather
 * than a suite to execute.
 */
const { regex } = MatchersV3

export const ULID = '[0-9A-HJKMNP-TV-Z]{26}'
export const brandExample = (prefix: string) => `${prefix}_00000000000000000000000000`

/** The metadata every fan-out event must carry, whatever its body. */
export const feedMetadata = (eventName: string) => ({
  'Nats-Msg-Id': regex(`^evt_${ULID}$`, brandExample('evt')),
  'event-name': eventName,
  'event-version': '1',
  'tenant.id': regex(`^comm_${ULID}$`, brandExample('comm')),
})

/** Just enough of a Zod schema to parse a payload that carries a community. */
interface CommunityScopedSchema {
  parse(input: unknown): { community_id: string }
}

/** The pact message as pact-js hands it to a raw `.verify` handler. */
interface PactMessageLike {
  contents: unknown
  metadata: unknown
}

/**
 * The consumer's expectation, expressed as the REAL code paths rather than a restatement of them:
 * the actual header reader and the actual event classifier, so a rename on either side fails the
 * contract instead of silently dropping the fan-out.
 *
 * Deliberately NOT `asynchronousBodyHandler` — that is `(m) => handler(m.contents)`, which discards
 * the metadata this consumer routes on and would leave every header assertion below unreachable.
 */
export const consumesAs =
  (eventType: string, schema: CommunityScopedSchema) =>
  async (message: PactMessageLike): Promise<void> => {
    const headers = readEventHeaders(message.metadata as Record<string, string>)
    expect(classifyEventType(headers.eventName)).toBe(eventType)
    expect(headers.communityId).toMatch(new RegExp(`^comm_${ULID}$`))
    expect(headers.eventId).toMatch(new RegExp(`^evt_${ULID}$`))
    // The body is pinned through the published schema because a delivered webhook forwards it to
    // the subscriber verbatim — its shape IS part of what webhooks promises onward, even though the
    // fan-out itself reads no individual field.
    expect(schema.parse(message.contents).community_id).toBe(headers.communityId)
  }
