import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The Tracetest suite is EVERY `*.yaml` under a `services/<svc>/tests/tracetest/` folder on disk —
 * discovered, never hand-listed. A hand-copied list orphaned the webhooks trace spec (it existed on
 * disk but ran in neither the CI tracetest lane nor `pnpm tracetest:results`, per the 2026-07-10
 * audit). Globbing from disk means a new spec is picked up automatically and cannot be silently
 * dropped; `scripts/tracetest-suite.test.ts` pins this to the on-disk set + the CI cluster-up list.
 *
 * Repo-relative POSIX paths, sorted for determinism.
 */
export function discoverTracetestDefs(root: string): string[] {
  const servicesDir = resolve(root, 'services')
  if (!existsSync(servicesDir)) return []
  return readdirSync(servicesDir)
    .map((svc) => `services/${svc}/tests/tracetest`)
    .filter((dir) => existsSync(resolve(root, dir)))
    .flatMap((dir) =>
      readdirSync(resolve(root, dir))
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map((f) => `${dir}/${f}`),
    )
    .sort()
}

/** The service names that own at least one Tracetest spec (e.g. `content`, `webhooks`). */
export function tracetestServices(root: string): string[] {
  return [...new Set(discoverTracetestDefs(root).map((d) => d.split('/')[1]))].sort()
}
