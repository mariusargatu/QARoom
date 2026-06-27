import {
  type Clock,
  CryptoRandomness,
  type IdGenerator,
  type Randomness,
  SystemClock,
  UlidIdGenerator,
} from '@qaroom/determinism'
import type { FastifyInstance } from 'fastify'

export interface ProductionDeps {
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
}

/** The production determinism trio. Tests inject seeded doubles instead. */
export function createProductionDeps(): ProductionDeps {
  return {
    clock: new SystemClock(),
    ids: new UlidIdGenerator(),
    randomness: new CryptoRandomness(),
  }
}

export interface RunServerOptions {
  port: number
  name: string
}

/**
 * The graceful-shutdown sequence, in order:
 *   1. begin draining — the app's shutdown signal flips, so `/ready` immediately returns 503 and
 *      Kubernetes pulls this pod from the Service endpoints (stops sending it NEW traffic), and
 *   2. `app.close()` — Fastify stops accepting new connections and waits for in-flight requests to
 *      finish before resolving (the in-flight drain).
 * Step 1 runs strictly before step 2, so readiness has already failed by the time the listener
 * starts tearing down. Apps without health routes (no shutdown signal decorated) simply skip the
 * readiness flip and close. The telemetry-flush SIGTERM handler installed by `@qaroom/otel`'s
 * preload is independent and still fires; this adds the HTTP-drain half.
 */
export async function drainAndClose(app: FastifyInstance): Promise<void> {
  app.shutdownSignal?.beginDrain()
  await app.close()
}

/** Shared production bootstrap: build, listen, log, drain on SIGTERM, exit non-zero on failure. */
export function runServer(
  build: () => FastifyInstance | Promise<FastifyInstance>,
  opts: RunServerOptions,
): void {
  const started = (async () => {
    const app = await build()
    installGracefulShutdown(app, opts.name)
    await app.listen({ port: opts.port, host: '0.0.0.0' })
    process.stdout.write(`${opts.name} listening on :${opts.port}\n`)
  })()
  started.catch((err: unknown) => {
    process.stderr.write(`${opts.name} failed to start: ${String(err)}\n`)
    process.exit(1)
  })
}

/** Drain the app on the first SIGTERM; a second SIGTERM mid-drain is ignored (idempotent). */
function installGracefulShutdown(app: FastifyInstance, name: string): void {
  let draining = false
  process.on('SIGTERM', () => {
    if (draining) return
    draining = true
    drainAndClose(app).catch((err: unknown) => {
      process.stderr.write(`${name} drain failed: ${String(err)}\n`)
    })
  })
}
