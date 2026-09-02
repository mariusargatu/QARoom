import { connect, type NatsConnection } from '@nats-io/transport-node'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'

/**
 * Real-JetStream fixture for `connection.spec.ts`.
 *
 * `connection.ts` — `connectNats` / `ensureStream` / `ensureConsumer` — had NO test of any kind
 * before 2026-08-11. It is the boot path, and it is the ONLY code that sets the stream's
 * `duplicate_window` (Commitment 17's server-side half) and a durable's `filter_subjects` (the
 * tenancy-carrying routing boundary). Everything else in the repo talks to `brokerDouble` or
 * `inMemoryBroker`, so nothing had ever exercised these calls against a real server — the same
 * class of blind spot that shipped identity's missing `NATS_URL` to a CrashLoopBackOff.
 *
 * Mirrors `snapshot-store.testkit.ts` exactly: env-gated so Docker stays out of the fast in-process
 * `pnpm test` lane, returns null when Docker is unreachable so the spec skips rather than fails, and
 * lives outside `*.spec.ts` because `qaroom/no-conditional-in-test` forbids the try/catch the
 * container bring-up needs.
 *
 * Image pinned to the same `nats:2-alpine` the services' docker-compose and the CI fuzz lane use,
 * with `-js` for JetStream and `-m 8222` for the monitoring endpoint the readiness probe reads.
 */
export interface NatsFixture {
  connection: NatsConnection
  stop: () => Promise<void>
}

export async function setupNats(): Promise<NatsFixture | null> {
  if (process.env.QAROOM_NATS_TESTS !== '1') return null
  let container: StartedTestContainer
  try {
    container = await new GenericContainer('nats:2-alpine')
      .withCommand(['-js', '-m', '8222'])
      .withExposedPorts(4222, 8222)
      // JetStream accepts TCP before it will answer a stream call; wait for the monitoring endpoint
      // rather than the port, or the first `jetstreamManager()` races the server's own start-up.
      .withWaitStrategy(Wait.forHttp('/healthz', 8222).forStatusCode(200))
      .start()
  } catch {
    // No reachable Docker daemon — skip rather than fail (the suite still runs everywhere).
    return null
  }
  const connection = await connect({
    servers: `nats://${container.getHost()}:${container.getMappedPort(4222)}`,
  })
  return {
    connection,
    stop: async () => {
      await connection.drain()
      await container.stop()
    },
  }
}
