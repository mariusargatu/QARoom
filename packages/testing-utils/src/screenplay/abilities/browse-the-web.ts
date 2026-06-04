import type { Page } from '@playwright/test'
import type { Ability } from '../ability'
import type { PageProvider } from '../page-provider'

/**
 * The E2E binding of the `PageProvider` seam: wraps a full Playwright `Page`. A Task that
 * goes through `actor.withPageProvider().getPage()` drives the real browser when the Actor
 * holds this ability. The component-test sibling (`InteractWithComponent`, Milestone 8) wraps
 * a CT mount and implements the same seam, so the Task source is identical across contexts.
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

  getPage(): Page {
    return this.#page
  }
}
