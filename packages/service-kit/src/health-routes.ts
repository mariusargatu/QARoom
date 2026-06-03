import type { FastifyInstance } from 'fastify'
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
 * DB-free: liveness only proves the process is up, so a transient DB blip never triggers
 * a restart loop. `/ready` runs the injected `readiness` check and returns an RFC 7807
 * 503 when dependencies are unreachable, so k8s stops routing to a degraded pod.
 */
export function registerHealthRoutes(app: FastifyInstance, opts: HealthRoutesOptions): void {
  app.get('/health', async (_req, reply) => {
    reply.code(200).send({ status: 'ok', service: opts.service })
  })

  app.get('/ready', async (_req, reply) => {
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
