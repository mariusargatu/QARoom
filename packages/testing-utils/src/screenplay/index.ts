export { BrowseTheWeb } from './abilities/browse-the-web'
export { InteractWithComponent } from './abilities/interact-with-component'
export type { Ability } from './ability'
export { Actor } from './actor'
export {
  LOC,
  type Loc,
  type LocatorSource,
  locate,
  locateTestId,
  placeholder,
  role,
  testId,
  text,
} from './locators'
export { isPageProvider, type PageProvider, type UiDriver, type UiHandle } from './page-provider'
export type { Question } from './question'
export { theClickCount } from './questions/the-click-count'
export { theFlagState } from './questions/the-flag-state'
export type { Task } from './task'
export { advanceRollout } from './tasks/advance-rollout'
export { castDonation } from './tasks/cast-donation'
export { clickTheButton } from './tasks/click-the-button'
// TESTID is NOT re-exported here: its one public path is `@qaroom/testing-utils/testids`
// (services/web/AGENTS.md). Importing it via this barrel was a second path for one concept.
