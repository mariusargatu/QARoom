import type { Page } from '@playwright/test'

/**
 * The single load-bearing seam (ADR-0005). Both `BrowseTheWeb` (full-page E2E) and the
 * Milestone-8 `InteractWithComponent` (a component-test mount) implement `getPage()`, so a
 * high-level Task that touches the browser ONLY through `actor.withPageProvider().getPage()`
 * runs unchanged in both E2E and component-test contexts. A Task that reaches for a concrete
 * ability (`BrowseTheWeb`) instead becomes E2E-bound and silently breaks the dual-context
 * promise — hence Tasks must route through `withPageProvider()`.
 */
export interface PageProvider {
  getPage(): Page
}

/** Structural guard: an Ability that can hand back a Playwright `Page`. */
export function isPageProvider(value: unknown): value is PageProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getPage' in value &&
    typeof (value as { getPage: unknown }).getPage === 'function'
  )
}
