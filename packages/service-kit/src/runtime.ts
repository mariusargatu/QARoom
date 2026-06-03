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

/** Shared production bootstrap: build, listen, log, and exit non-zero on failure. */
export function runServer(
  build: () => FastifyInstance | Promise<FastifyInstance>,
  opts: RunServerOptions,
): void {
  const started = (async () => {
    const app = await build()
    await app.listen({ port: opts.port, host: '0.0.0.0' })
    process.stdout.write(`${opts.name} listening on :${opts.port}\n`)
  })()
  started.catch((err: unknown) => {
    process.stderr.write(`${opts.name} failed to start: ${String(err)}\n`)
    process.exit(1)
  })
}
