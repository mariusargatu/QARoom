import { TESTID } from './testids'

/**
 * The central LOCATOR registry (the Page-Object pattern). Every selector a test uses to find an
 * element lives here ONCE, organized by component, so a renamed button or moved element is a
 * one-line change — not a hunt across 60 test files. The same descriptors are resolved against
 * BOTH runtimes: a `vitest-browser` render result (component tests) and a Playwright `Page` (E2E),
 * via {@link locate}. The raw `data-testid` STRINGS live in `testids.ts` (`TESTID`) — components
 * render those; `LOC` builds locator descriptors from them (+ role/text). One string, two consumers.
 */

/** A runtime-agnostic locator descriptor. `label` is intentionally absent — vitest uses
 *  `getByLabelText`, Playwright `getByLabel`; query a labelled control by its role + accessible name. */
export type Loc =
  | { by: 'testId'; value: string }
  | { by: 'role'; role: string; name?: string | RegExp }
  | { by: 'text'; value: string | RegExp }
  | { by: 'placeholder'; value: string }

export const testId = (value: string): Loc => ({ by: 'testId', value })
export const role = (roleName: string, name?: string | RegExp): Loc => ({
  by: 'role',
  role: roleName,
  name,
})
export const text = (value: string | RegExp): Loc => ({ by: 'text', value })
export const placeholder = (value: string): Loc => ({ by: 'placeholder', value })

/**
 * The query surface both `vitest-browser` (render result / `page`) and Playwright (`Page` / `Locator`)
 * share under identical method names — so one {@link locate} works for both. Returns are typed
 * `unknown` because each runtime has its own `Locator`; the caller casts (or uses `mountComponent`'s
 * typed `find`).
 */
export interface LocatorSource {
  getByTestId(id: string): unknown
  getByRole(roleName: string, options?: { name?: string | RegExp }): unknown
  getByText(value: string | RegExp): unknown
  getByPlaceholder(value: string): unknown
}

/** The testid-only driver the Screenplay layer narrows to (ADR-0027 §2). */
interface TestIdDriver {
  getByTestId(id: string): unknown
}

/**
 * Resolve a `testId` {@link Loc} against the narrowed Screenplay `UiDriver` (testid-only by ADR-0027,
 * so a single Task source runs in both runtimes). Throws on a richer locator the seam cannot serve —
 * making "the Screenplay layer locates by testid only" a runtime check, not a convention.
 */
export function locateTestId<L = unknown>(driver: TestIdDriver, loc: Loc): L {
  if (loc.by !== 'testId') {
    throw new Error(`Screenplay UiDriver resolves testId locators only, got '${loc.by}'`)
  }
  return driver.getByTestId(loc.value) as L
}

/** Resolve a {@link Loc} against any {@link LocatorSource}; returns that runtime's locator. */
export function locate<L = unknown>(source: LocatorSource, loc: Loc): L {
  switch (loc.by) {
    case 'testId':
      return source.getByTestId(loc.value) as L
    case 'role':
      return source.getByRole(
        loc.role,
        loc.name !== undefined ? { name: loc.name } : undefined,
      ) as L
    case 'text':
      return source.getByText(loc.value) as L
    case 'placeholder':
      return source.getByPlaceholder(loc.value) as L
  }
}

/**
 * Locators by component, for the dual-context Screenplay flows (the ones where a single Task source
 * runs as both a component test and an E2E). Every entry here is rendered by a web component AND
 * located by a Task/Question — no aspirational rows. Atoms with no cross-runtime Task (Avatar, Badge,
 * VoteControl, …) are queried by ARIA role in their own component tests, the stronger query; they
 * deliberately do not appear here. Co-located with `TESTID` so the components, the Tasks, and the E2E
 * suite all import the one selector source.
 */
export const LOC = {
  rollout: {
    state: testId(TESTID.rolloutState),
    advance: (event: string) => testId(TESTID.rolloutAdvance(event)),
  },
  donation: {
    amount: testId(TESTID.donationAmount),
    submit: testId(TESTID.donationSubmit),
    list: testId(TESTID.donationList),
  },
  button: {
    under: testId(TESTID.buttonUnderTest),
    count: testId(TESTID.buttonClickCount),
  },
} as const
