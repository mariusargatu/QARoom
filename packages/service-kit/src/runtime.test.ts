import type { AddressInfo } from 'node:net'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerHealthRoutes } from './health-routes'
import { registerProblemHandler } from './problem'
import { createProductionDeps, drainAndClose, runServer } from './runtime'

/** A promise plus its resolver — to hold a request in-flight until the test releases it. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// `runServer` installs a process SIGTERM listener (graceful drain). In tests it would otherwise leak
// across cases and fire against a fake app at worker teardown — snapshot the baseline and strip any
// listener a test added.
const sigtermBaseline = process.listeners('SIGTERM')
afterEach(() => {
  process
    .listeners('SIGTERM')
    .filter((listener) => !sigtermBaseline.includes(listener))
    .forEach((listener) => {
      process.removeListener('SIGTERM', listener)
    })
})

describe('createProductionDeps', () => {
  it('returns the production determinism trio (live clock, ulid ids, crypto randomness)', () => {
    const deps = createProductionDeps()
    expect(deps.clock.now()).toBeInstanceOf(Date)
    expect(typeof deps.ids.next('post')).toBe('string')
    const r = deps.randomness.next()
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(1)
  })
})

describe('runServer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds the app, listens on the configured port, and logs a ready line', async () => {
    const listen = vi.fn().mockResolvedValue(undefined)
    const fakeApp = { listen } as unknown as FastifyInstance
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    })

    runServer(() => fakeApp, { port: 8123, name: 'demo' })

    await vi.waitFor(() => expect(writes.join('')).toContain('demo listening on :8123'))
    expect(listen).toHaveBeenCalledWith({ port: 8123, host: '0.0.0.0' })
  })

  it('logs to stderr and exits non-zero when the build fails', async () => {
    const errors: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      errors.push(String(chunk))
      return true
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    runServer(
      () => {
        throw new Error('boot blew up')
      },
      { port: 8123, name: 'demo' },
    )

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(errors.join('')).toContain('demo failed to start')
    expect(errors.join('')).toContain('boot blew up')
  })
})

describe('drainAndClose (graceful shutdown sequence)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flips /ready to 503 STRICTLY before it closes the server', async () => {
    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    registerHealthRoutes(app, { service: 'demo', readiness: async () => {} })

    // Healthy and ready before shutdown begins.
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200)

    // Capture what /ready reports at the exact moment app.close() is first invoked. Because
    // drainAndClose begins draining before closing, readiness must already be 503 here — proving
    // the ordering k8s relies on (endpoint removed before the listener tears down).
    let readyStatusWhenCloseBegan: number | undefined
    const realClose = app.close.bind(app)
    vi.spyOn(app, 'close').mockImplementation((() =>
      (async () => {
        const probe = await app.inject({ method: 'GET', url: '/ready' })
        readyStatusWhenCloseBegan = probe.statusCode
        return realClose()
      })()) as typeof app.close)

    await drainAndClose(app)

    expect(readyStatusWhenCloseBegan).toBe(503)
    expect(app.close).toHaveBeenCalledTimes(1)
  })

  it('lets an in-flight request finish while draining, then closes', async () => {
    const entered = deferred()
    const release = deferred()

    const app = Fastify({ logger: false })
    registerProblemHandler(app)
    registerHealthRoutes(app, { service: 'demo', readiness: async () => {} })
    app.get('/slow', async () => {
      entered.resolve()
      await release.promise
      return { handled: true }
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`

    // Issue a request and wait until it is genuinely in-flight inside the handler.
    const inflight = fetch(`${base}/slow`)
    await entered.promise

    // Begin graceful shutdown with the request still in-flight; close() must wait for it.
    const draining = drainAndClose(app)
    release.resolve()

    const res = await inflight
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ handled: true })

    await draining
  })

  it('closes an app with no health routes (no shutdown signal) without throwing', async () => {
    const app = Fastify({ logger: false })
    const close = vi.spyOn(app, 'close')
    await drainAndClose(app)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
