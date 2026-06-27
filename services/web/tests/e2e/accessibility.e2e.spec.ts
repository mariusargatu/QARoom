import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Full-journey accessibility (T17, "Frontend health"). Storybook's `addon-a11y` runs axe per STORY —
 * a component rendered in isolation, which empirically catches only ~30-40% of WCAG issues. The
 * interesting failures live in the COMPOSED page: landmark/heading order across organisms, focus
 * order through real navigation, and color contrast once tokens land on actual content. This runs
 * `@axe-core/playwright` over FULL-PAGE renders in the live-stack E2E suite (not component stories)
 * — the same browser the MBT rollout flows use. Requires the app served (and the gateway for routed
 * pages): a dispatched lane / `pnpm dev`, hence E2E, not the in-process unit run.
 *
 * Scoped to the unauthenticated `/login` shell so it needs no seeded session: the route renders the
 * full page chrome (landmarks, headings, the auth form) against a real browser. Authenticated
 * journeys (feed, flags, moderation) are a NAMED follow-up — they need the seeded-session setup the
 * rollout E2E already carries, and the dynamic-content axe scan over live WS updates is the harder,
 * higher-value pass called out in the card.
 *
 * WCAG 2.0/2.1 level A + AA tags only — the conformance bar the design system targets; axe's
 * best-practice and experimental rules are excluded so the gate tracks the standard, not opinion.
 */
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const FULL_PAGES = [{ name: 'login', path: '/login' }] as const

for (const { name, path } of FULL_PAGES) {
  test(`full-page a11y: ${name} has no WCAG 2 A/AA violations`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze()
    // Assert on the rule ids so a failure names exactly which WCAG rules tripped (the full node
    // detail is in the Playwright report), rather than dumping opaque result objects.
    expect(results.violations.map((v) => v.id)).toEqual([])
  })
}
