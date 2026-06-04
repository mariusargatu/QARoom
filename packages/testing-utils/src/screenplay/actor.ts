import type { Ability } from './ability'
import { isPageProvider, type PageProvider } from './page-provider'
import type { Question } from './question'
import type { Task } from './task'

/**
 * An Actor performs Tasks and asks Questions through the Abilities it holds. The only way a
 * Task reaches the browser is `withPageProvider()`, which returns whichever held ability is a
 * `PageProvider` — `BrowseTheWeb` in E2E, `InteractWithComponent` in component tests. This is
 * the seam that lets one Task source run in both contexts (ADR-0005).
 */
export class Actor {
  readonly name: string
  readonly #abilities = new Map<string, Ability>()

  private constructor(name: string) {
    this.name = name
  }

  static named(name: string): Actor {
    return new Actor(name)
  }

  /** Grant an ability. Chainable. */
  can(ability: Ability): this {
    this.#abilities.set(ability.name, ability)
    return this
  }

  /** Retrieve a concrete ability by name. Throws if the Actor lacks it. */
  abilityTo<A extends Ability>(name: string): A {
    const ability = this.#abilities.get(name)
    if (!ability) {
      throw new Error(`${this.name} cannot ${name}`)
    }
    return ability as A
  }

  /**
   * The dual-context seam. Returns the held `PageProvider` ability (E2E `BrowseTheWeb` or
   * component-test `InteractWithComponent`) without the caller naming which — so Tasks stay
   * context-agnostic. Throws if no page-providing ability is held.
   */
  withPageProvider(): PageProvider {
    for (const ability of this.#abilities.values()) {
      if (isPageProvider(ability)) return ability
    }
    throw new Error(
      `${this.name} has no PageProvider ability (BrowseTheWeb or InteractWithComponent)`,
    )
  }

  /** Perform tasks in order. */
  async attemptsTo(...tasks: Task[]): Promise<void> {
    for (const task of tasks) {
      await task.performAs(this)
    }
  }

  /** Ask a question and return its answer. */
  async asks<T>(question: Question<T>): Promise<T> {
    return question.answeredBy(this)
  }
}
