import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TestResultsSummary } from '@qaroom/contracts'

/**
 * Reads the frozen `test-results/summary.json` and validates it against the
 * do-not-touch schema before exposing it as a resource. Injectable so tests pin a
 * fixture (the live file is time-varying).
 */
export interface SummaryProvider {
  read(): TestResultsSummary | null
}

export const DEFAULT_SUMMARY_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'test-results',
  'summary.json',
)

export function fileSummaryProvider(summaryPath: string = DEFAULT_SUMMARY_PATH): SummaryProvider {
  return {
    read() {
      if (!existsSync(summaryPath)) return null
      return TestResultsSummary.parse(JSON.parse(readFileSync(summaryPath, 'utf8')))
    },
  }
}

export function staticSummaryProvider(summary: TestResultsSummary | null): SummaryProvider {
  return { read: () => summary }
}
