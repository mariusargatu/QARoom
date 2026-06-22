import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProductionDeps, runServer } from './runtime'

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
