import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverTracetestDefs, tracetestServices } from './lib/tracetest-defs'

// The Tracetest suite was enumerated in three disagreeing places (tracetest-results.ts, the CI
// _integration tracetest job, and matrix-cluster), which orphaned the webhooks trace spec — it ran
// in neither the primary CI lane nor `pnpm tracetest:results` (2026-07-10 audit). The fix derives the
// suite from disk in one place; this test pins that the derived suite covers every on-disk spec AND
// that the CI lane both runs the disk-globbing script and brings up every service that owns a spec,
// so a new spec can never be silently un-run again. Runs via `pnpm test:scripts`.
const ROOT = resolve(__dirname, '..')
const integrationYml = readFileSync(resolve(ROOT, '.github/workflows/_integration.yml'), 'utf8')

// The tracetest job body: from its `  tracetest:` header to the next top-level (2-space) job key.
const rest = integrationYml.slice(
  integrationYml.indexOf('\n  tracetest:') + '\n  tracetest:'.length,
)
const nextJobIdx = rest.search(/\n {2}[a-z][a-z0-9_-]*:\n/)
const tracetestJob = nextJobIdx >= 0 ? rest.slice(0, nextJobIdx) : rest
const clusterUpServices = (tracetestJob.match(/services:\s*(.+)/)?.[1] ?? '')
  .trim()
  .split(/\s+/)
  .filter(Boolean)

const defs = discoverTracetestDefs(ROOT)
const services = tracetestServices(ROOT)

describe('the Tracetest suite is derived from disk and cannot orphan a spec', () => {
  it('discovers a non-trivial suite (guard is not vacuously green)', () => {
    expect(defs.length).toBeGreaterThanOrEqual(6)
  })

  it('includes the webhooks trace spec (the one the 2026-07-10 audit found orphaned)', () => {
    expect(defs).toContain('services/webhooks/tests/tracetest/webhook-create-coherent-trace.yaml')
  })

  it('the CI tracetest job runs the disk-globbing pnpm tracetest:results, not a drifting inline list', () => {
    expect(tracetestJob).toContain('pnpm tracetest:results')
  })

  it('the CI tracetest lane brings up every service that owns a trace spec', () => {
    expect(services.filter((s) => !clusterUpServices.includes(s))).toEqual([])
  })
})
