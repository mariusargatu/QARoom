import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { K6_ENDPOINTS, SLO_TARGETS } from '@qaroom/contracts'

/**
 * Project the in-code `SLO_TARGETS` (the single source of truth, pinned to `docs/slos.md` by
 * `slos.test.ts`) into a JSON file k6 can read at init — k6 runs in goja and cannot import the
 * TypeScript contracts. Committed and regenerated-and-diffed in CI (`pnpm k6:gen && git diff --exit-code`)
 * so the load thresholds never drift from the documented SLOs. 2-space JSON = biome-clean by construction.
 */
const ROOT = process.cwd()
const outPath = resolve(ROOT, 'load-tests/lib/slo-thresholds.gen.json')

const endpoints = Object.fromEntries(K6_ENDPOINTS.map((key) => [key, SLO_TARGETS[key]]))
const doc = { generated_from: 'packages/contracts/src/slos.ts', endpoints }

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`)
process.stdout.write(`wrote ${outPath} (${K6_ENDPOINTS.length} endpoints)\n`)
