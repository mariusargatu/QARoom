import type { Page } from '@playwright/test'
import type { Ability } from '../ability'
import type { PageProvider } from '../page-provider'

/**
 * The component-test binding of the `PageProvider` seam (introduced now, exercised in
 * Milestone 8). In a Playwright Component Test the raw component is mounted with its
 * `story.args` and the surrounding `page` drives it; this ability wraps that page so the SAME
 * Task source that runs in E2E (via `BrowseTheWeb`) runs against a mounted component — only
 * the ability binding differs (ADR-0005). Shipping the seam in Milestone 5 keeps the
 * Milestone-8 component suite a binding change, not a rewrite.
 */
export class InteractWithComponent implements Ability, PageProvider {
  readonly name = 'InteractWithComponent'
  readonly #page: Page

  private constructor(page: Page) {
    this.#page = page
  }

  /**
   * `page` is the CT test's page after the component has been mounted with `story.args`.
   * Matches `BrowseTheWeb.using(page)` so the seam reads the same on both sides.
   */
  static using(page: Page): InteractWithComponent {
    return new InteractWithComponent(page)
  }

  getPage(): Page {
    return this.#page
  }
}
