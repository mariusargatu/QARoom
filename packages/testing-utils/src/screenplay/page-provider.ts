/**
 * The single load-bearing seam (ADR-0005, narrowed by ADR-0027). Both `BrowseTheWeb` (full-page
 * E2E, wrapping a Playwright `Page`) and `InteractWithComponent` (a Vitest-browser component mount)
 * implement `getDriver()`, so a high-level Task that touches the UI ONLY through
 * `actor.withPageProvider().getDriver()` runs unchanged in both contexts. A Task that reaches for a
 * concrete ability (`BrowseTheWeb`) instead becomes E2E-bound and silently breaks the dual-context
 * promise — hence Tasks must route through `withPageProvider()`.
 *
 * The driver is deliberately the SMALLEST surface the Tasks/Questions actually use, so that both a
 * Playwright `Locator` (E2E) and a `vitest-browser` locator (component) satisfy it directly. That is
 * what makes "one Task source, two runtimes" true at the type level instead of by Playwright
 * coupling (ADR-0027 §2).
 */

/** A located element the Tasks can act on. The intersection of Playwright + vitest-browser locators. */
export interface UiHandle {
  click(): Promise<void>
  fill(value: string): Promise<void>
  textContent(): Promise<string | null>
}

/** Locate an element by its `data-testid`. The only locator strategy the Screenplay layer uses. */
export interface UiDriver {
  getByTestId(testId: string): UiHandle
}

/** An ability that can hand back a runtime-agnostic `UiDriver`. */
export interface PageProvider {
  getDriver(): UiDriver
}

/** Structural guard: an Ability that can hand back a `UiDriver`. */
export function isPageProvider(value: unknown): value is PageProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getDriver' in value &&
    typeof (value as { getDriver: unknown }).getDriver === 'function'
  )
}
