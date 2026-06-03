import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TestResultsSummary } from '@qaroom/contracts'

/** Validate `test-results/summary.json` against the frozen schema (Commitment 14). */
const path = resolve(process.cwd(), 'test-results/summary.json')
const summary = TestResultsSummary.parse(JSON.parse(readFileSync(path, 'utf8')))

process.stdout.write(
  `summary.json valid — schema_version=${summary.schema_version}, ${summary.runners.length} runners, ${summary.totals.passed} passed / ${summary.totals.failed} failed\n`,
)
