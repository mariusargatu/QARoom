import type { FastifyInstance } from 'fastify'
import { ensureShutdownSignal } from './lifecycle'
import { problem } from './problem'

export interface HealthRoutesOptions {
  service: string
  /**
   * Optional readiness check — resolves when dependencies (e.g. the database) are
   * reachable, rejects otherwise. Absent ⇒ the service is always ready. Kept as an
   * injected callback so service-kit stays free of any DB dependency.
   */
  readiness?: () => Promise<void>
}

/**
 * Kubernetes liveness + readiness probes (Milestone 3). `/health` is deliberately
 * DB-free: liveness only proves the process is up, so a transient DB blip — or an in-progress
 * graceful drain — never triggers a restart loop. `/ready` returns an RFC 7807 503 when the
 * service should not receive NEW traffic, in two cases, so k8s stops routing to it:
 *   - a critical dependency is unreachable (the injected `readiness` check rejects), or
 *   - the pod has begun graceful shutdown (SIGTERM → `runServer` flips the shutdown signal).
 * The drain check is consulted first so a shutting-down pod fails readiness immediately, before any
 * dependency probe runs.
 */
export function registerHealthRoutes(app: FastifyInstance, opts: HealthRoutesOptions): void {
  const lifecycle = ensureShutdownSignal(app)

  app.get('/health', async (_req, reply) => {
    reply.code(200).send({ status: 'ok', service: opts.service })
  })

  app.get('/ready', async (_req, reply) => {
    if (lifecycle.draining) {
      throw problem({
        slug: 'service-draining',
        title: 'Service draining',
        status: 503,
        failure_domain: 'dependency_failure',
        detail: `${opts.service} is shutting down and is no longer accepting new requests.`,
        retryable: true,
      })
    }
    if (opts.readiness === undefined) {
      reply.code(200).send({ status: 'ready', service: opts.service })
      return
    }
    try {
      await opts.readiness()
    } catch {
      throw problem({
        slug: 'service-not-ready',
        title: 'Service not ready',
        status: 503,
        failure_domain: 'dependency_failure',
        detail: `${opts.service} dependencies are not reachable.`,
        retryable: true,
      })
    }
    reply.code(200).send({ status: 'ready', service: opts.service })
  })
}
