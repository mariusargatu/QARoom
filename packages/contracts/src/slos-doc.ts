import { readFileSync } from 'node:fs'
import type { SloTarget } from './slos'

/**
 * Parser for the `## Targets` table in `docs/slos.md`, used only by `slos.test.ts` to pin the prose
 * doc equal to `SLO_TARGETS`. Lives outside the test file because the drift parse needs branching,
 * which `qaroom/no-conditional-in-test` forbids in `*.test.ts`. Not exported from the package barrel.
 */
const DOC_URL = new URL('../../../docs/slos.md', import.meta.url)

function parseRow(line: string): SloTarget | null {
  const cells = line.split('|').map((c) => c.trim())
  // A data row is `| `route` | latency | error | availability |` → 4 inner cells between empty edges.
  if (cells.length !== 6) return null
  const route = (cells[1] ?? '').replace(/`/g, '')
  const method = route.startsWith('GET ') ? 'GET' : route.startsWith('POST ') ? 'POST' : null
  if (method === null) return null

  const latencyCell = (cells[2] ?? '').toLowerCase()
  let latencyMs: SloTarget['latencyMs'] = null
  if (latencyCell !== 'unbounded') {
    const nums = latencyCell
      .replace(/ms/i, '')
      .split('/')
      .map((n) => Number(n.trim()))
    latencyMs = { p50: nums[0] ?? 0, p95: nums[1] ?? 0, p99: nums[2] ?? 0 }
  }

  // "< 0.5%" → 0.005
  const errorRate = Number((cells[3] ?? '').replace(/[<%\s]/g, '')) / 100
  const availabilityCell = (cells[4] ?? '').toLowerCase()
  const availability =
    availabilityCell === 'best-effort' ? null : Number((cells[4] ?? '').replace(/[%\s]/g, '')) / 100

  return { route, method, latencyMs, errorRate, availability }
}

/** Every data row of the SLO targets table, in document order. */
export function parseSlosDocTable(): SloTarget[] {
  return readFileSync(DOC_URL, 'utf8')
    .split('\n')
    .map(parseRow)
    .filter((r): r is SloTarget => r !== null)
}
