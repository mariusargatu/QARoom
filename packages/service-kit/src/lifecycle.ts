import type { FastifyInstance } from 'fastify'

/**
 * A process-lifecycle flag, flipped exactly once when graceful shutdown begins (on SIGTERM).
 * `false` while the service is serving normally; `true` once it has started draining.
 *
 * `/ready` consults it so Kubernetes pulls a draining pod from the Service endpoints and routes
 * NEW traffic elsewhere while the pod's in-flight requests finish — the readiness-gate half of
 * graceful shutdown. Liveness (`/health`) is deliberately NOT gated on it: the process is still
 * alive mid-drain and must not be restarted out from under its in-flight work.
 */
export interface ShutdownSignal {
  readonly draining: boolean
  beginDrain(): void
}

export function createShutdownSignal(): ShutdownSignal {
  let draining = false
  return {
    get draining() {
      return draining
    },
    beginDrain() {
      draining = true
    },
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    shutdownSignal?: ShutdownSignal
  }
}

/**
 * Attach a shutdown signal to the app exactly once and return it. `registerHealthRoutes` calls this
 * so `/ready` can read the flag; `runServer` reads the same signal back off the app on SIGTERM to
 * begin draining. Already-decorated apps reuse the existing signal (never re-decorated), so every
 * registrar on one app observes a single, shared lifecycle state.
 */
export function ensureShutdownSignal(app: FastifyInstance): ShutdownSignal {
  const existing = app.hasDecorator('shutdownSignal') ? app.shutdownSignal : undefined
  if (existing) return existing
  const signal = createShutdownSignal()
  app.decorate('shutdownSignal', signal)
  return signal
}
