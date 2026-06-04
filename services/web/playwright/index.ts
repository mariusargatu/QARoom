import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test as base, expect } from '@playwright/experimental-ct-react'

/**
 * Coverage-collecting CT fixture (Milestone 8). CT files import `test`/`expect` from here (not
 * straight from `@playwright/experimental-ct-react`) so that, under `COVERAGE=true`, each page's
 * Istanbul `window.__coverage__` is harvested into `.nyc_output/` — the Istanbul half that
 * `scripts/merge-coverage.ts` reconciles with Vitest's V8. When `COVERAGE` is unset the fixture
 * is a passthrough, so the example CT runs normally without coverage. Browser-required.
 */
const COVERAGE = process.env.COVERAGE === 'true'

interface IstanbulWindow {
  __coverage__?: unknown
}

let counter = 0

export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page)
    if (!COVERAGE) return
    const coverage = await page.evaluate(() => (window as unknown as IstanbulWindow).__coverage__)
    if (!coverage) return
    counter += 1
    const dir = resolve(process.cwd(), '.nyc_output')
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, `playwright_coverage_${counter}.json`), JSON.stringify(coverage))
  },
})

export { expect }
