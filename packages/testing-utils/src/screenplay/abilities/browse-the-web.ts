import type { Page } from '@playwright/test'
import type { Ability } from '../ability'
import type { PageProvider, UiDriver } from '../page-provider'

/**
 * The E2E binding of the `PageProvider` seam: wraps a full Playwright `Page`. A Task that goes
 * through `actor.withPageProvider().getDriver()` drives the real browser when the Actor holds this
 * ability. A Playwright `Locator` already satisfies `UiHandle` (`click`/`fill`/`textContent`), so
 * `getDriver()` is a direct passthrough. The component-test sibling (`InteractWithComponent`) wraps
 * a Vitest-browser locator and implements the same seam, so the Task source is identical across
 * contexts (ADR-0005, narrowed by ADR-0027).
 */
export class BrowseTheWeb implements Ability, PageProvider {
  readonly name = 'BrowseTheWeb'
  readonly #page: Page

  private constructor(page: Page) {
    this.#page = page
  }

  static using(page: Page): BrowseTheWeb {
    return new BrowseTheWeb(page)
  }

  getDriver(): UiDriver {
    const page = this.#page
    return { getByTestId: (testId) => page.getByTestId(testId) }
  }
}
