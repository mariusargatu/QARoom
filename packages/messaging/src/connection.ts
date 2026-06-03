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
