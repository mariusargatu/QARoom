import { type JetStreamClient, jetstream, jetstreamManager } from '@nats-io/jetstream'
import { type NatsConnection, nanos } from '@nats-io/nats-core'
import { connect } from '@nats-io/transport-node'
import { QAROOM_STREAM_SUBJECTS } from '@qaroom/contracts'

/** The single JetStream stream all QARoom events flow through. */
export const QAROOM_STREAM = 'qaroom'
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000 // Commitment 17: duplicate_window 5m

export interface NatsHandle {
  connection: NatsConnection
  js: JetStreamClient
  close(): Promise<void>
}

/** Connect to NATS, ensure the stream exists, and return a JetStream client. */
export async function connectNats(servers: string): Promise<NatsHandle> {
  const connection = await connect({ servers })
  await ensureStream(connection)
  return { connection, js: jetstream(connection), close: () => connection.drain() }
}

/**
 * Idempotently ensure the `qaroom` stream exists over `qaroom.>` with `duplicate_window`
 * set to 5 minutes (Commitment 17 — JetStream drops same-`Nats-Msg-Id` republishes within
 * the window). Safe to call on every boot.
 */
export async function ensureStream(connection: NatsConnection): Promise<void> {
  const jsm = await jetstreamManager(connection)
  const config = {
    name: QAROOM_STREAM,
    subjects: [QAROOM_STREAM_SUBJECTS],
    duplicate_window: nanos(DUPLICATE_WINDOW_MS),
  }
  try {
    await jsm.streams.info(QAROOM_STREAM)
    await jsm.streams.update(QAROOM_STREAM, config)
  } catch {
    await jsm.streams.add(config)
  }
}

/**
 * Idempotently ensure a durable consumer exists on the stream, optionally filtered to a subset
 * of subjects. Consumers are fetched with `consumers.get`, which requires a pre-created durable —
 * so a consuming service must `ensureConsumer` first. The filter keeps a service's own published
 * events out of a handler that only understands a sibling's events. Durable names cannot contain
 * a '.' (JetStream rejects it), so callers pass hyphenated names.
 */
export async function ensureConsumer(
  handle: NatsHandle,
  opts: { stream: string; durable: string; filterSubjects?: string[] },
): Promise<void> {
  const jsm = await jetstreamManager(handle.connection)
  const want = opts.filterSubjects ?? []
  try {
    await jsm.consumers.add(opts.stream, {
      durable_name: opts.durable,
      ack_policy: 'explicit',
      ...(want.length > 0 ? { filter_subjects: want } : {}),
    })
  } catch (err) {
    // Tolerate "already exists"; surface anything else (e.g. missing stream, connection fault) —
    // a blanket `.catch(() => undefined)` would hide those and resurface them as a confusing
    // ConsumerNotFound at the caller's `consumers.get`.
    const existing = await jsm.consumers.info(opts.stream, opts.durable).catch(() => null)
    if (!existing) throw err
    // It exists — but if the committed filter drifted from the live consumer, warn loudly: a
    // durable's filter cannot be changed by re-adding, so the old filter silently stays in force.
    const have = existing.config.filter_subjects ?? []
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      process.stderr.write(
        `ensureConsumer: durable "${opts.durable}" already exists with filter_subjects ` +
          `${JSON.stringify(have)}, wanted ${JSON.stringify(want)} — delete the durable to apply ` +
          `the change (re-adding does not update it).\n`,
      )
    }
  }
}
