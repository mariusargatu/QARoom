import { Actor, InteractWithComponent, type UiDriver } from '../screenplay'

/**
 * Structural shape of a `vitest-browser` locator and its source (a `vitest-browser-react`
 * `render()` result, or the `@vitest/browser/context` `page`). Typed structurally — NOT imported —
 * so `@qaroom/testing-utils` stays free of any browser-runner dependency (ADR-0027 §2). Any object
 * whose `getByTestId(id)` yields `{ click, fill, element }` works.
 */
interface BrowserLocator {
  click(): Promise<void>
  fill(value: string): Promise<void>
  /**
   * `query()` returns the matched node or `null` (the NON-throwing accessor — vitest-browser's
   * `element()` throws when absent). We use it so the component-side read mirrors the E2E side's
   * Playwright `Locator.textContent()` contract — `Promise<string | null>`, never a hard throw on a
   * not-yet-rendered element. Typed structurally to keep this package DOM-lib-free.
   */
  query(): { textContent: string | null } | null
}
export interface BrowserLocatorSource {
  getByTestId(testId: string): BrowserLocator
}

/**
 * The Vitest-browser → Screenplay bridge (ADR-0027, supersedes the Playwright-CT bridge of ADR-0005).
 * Given a `vitest-browser-react` `render()` result, returns an Actor whose `PageProvider` ability is
 * `InteractWithComponent` over a `UiDriver` adapted from the render's locators. Because every
 * Task/Question touches the UI only through `actor.withPageProvider().getDriver()`, the SAME Task
 * source that runs in E2E via `BrowseTheWeb` runs here against a mounted component — only the ability
 * binding differs.
 */
export function createComponentActor(screen: BrowserLocatorSource, name = 'Component user'): Actor {
  const driver: UiDriver = {
    getByTestId(testId) {
      const located = screen.getByTestId(testId)
      return {
        click: () => located.click(),
        fill: (value) => located.fill(value),
        // Non-throwing read (parity with Playwright's auto-waiting textContent — see BrowserLocator).
        textContent: async () => located.query()?.textContent ?? null,
      }
    },
  }
  return Actor.named(name).can(InteractWithComponent.using(driver))
}
