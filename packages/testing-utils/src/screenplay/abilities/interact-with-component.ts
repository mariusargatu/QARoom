import type { Ability } from '../ability'
import type { PageProvider, UiDriver } from '../page-provider'

/**
 * The component-test binding of the `PageProvider` seam (ADR-0005, narrowed by ADR-0027). Holds a
 * `UiDriver` adapted from a Vitest-browser component mount (see `screenplay-ct/create-component-actor`).
 * Because Tasks touch the UI only through `actor.withPageProvider().getDriver()`, the SAME Task source
 * that runs in E2E via `BrowseTheWeb` runs here against a mounted component — only the ability binding
 * differs. The ability stays runtime-library-free: the `vitest-browser` → `UiDriver` adaptation lives
 * in the bridge, so this core module never imports a browser runner.
 */
export class InteractWithComponent implements Ability, PageProvider {
  readonly name = 'InteractWithComponent'
  readonly #driver: UiDriver

  private constructor(driver: UiDriver) {
    this.#driver = driver
  }

  static using(driver: UiDriver): InteractWithComponent {
    return new InteractWithComponent(driver)
  }

  getDriver(): UiDriver {
    return this.#driver
  }
}
