import { CommunityId } from '@qaroom/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { SYSTEM_TENANT, tenantStore } from './tenant-context'

/** Derive the tenant for a request: the `communityId` path param if present + valid, else `system`. */
function tenantOf(req: FastifyRequest): string {
  const raw = (req.params as { communityId?: string } | undefined)?.communityId
  if (raw === undefined) return SYSTEM_TENANT
  const parsed = CommunityId.safeParse(raw)
  return parsed.success ? parsed.data : SYSTEM_TENANT
}

/**
 * Register the per-request tenant binding. `enterWith` sets the ambient tenant for the
 * remainder of the request's async context (handler + child DB/outbound spans), so the
 * `TenantSpanProcessor` stamps the right `tenant.id` everywhere. Register this BEFORE other
 * hooks so the HTTP root span is covered too.
 */
export function registerTenantContext(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    tenantStore.enterWith(tenantOf(req))
  })
}
