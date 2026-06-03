import { AsyncLocalStorage } from 'node:async_hooks'

/** Sentinel tenant for spans not scoped to a community (boot, /system/*, /health). */
export const SYSTEM_TENANT = 'system'

/**
 * The ambient tenant store. Every span started while a value is set (via the Fastify
 * plugin's `enterWith` or `withTenant`) is stamped with that community id by the
 * `TenantSpanProcessor`. `node:async_hooks` is a core module — no determinism leak.
 */
export const tenantStore = new AsyncLocalStorage<string>()

/** Run `fn` with `communityId` as the ambient tenant for every span started inside it. */
export function withTenant<T>(communityId: string, fn: () => T): T {
  return tenantStore.run(communityId, fn)
}

/** The tenant in scope, or the `system` sentinel — so EVERY span gets a `tenant.id`. */
export function currentTenant(): string {
  return tenantStore.getStore() ?? SYSTEM_TENANT
}
