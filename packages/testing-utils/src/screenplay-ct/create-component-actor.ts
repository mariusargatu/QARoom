import type { MountResult } from '@playwright/experimental-ct-react'
import { Actor, InteractWithComponent } from '../screenplay'

/**
 * The Playwright-Component-Test → Screenplay bridge (Milestone 8). Given a `mount()` result,
 * returns an Actor whose `PageProvider` ability is `InteractWithComponent` wrapping the CT host
 * page (`mountResult.page()`). Because every Task/Question touches the browser only through
 * `actor.withPageProvider().getPage()`, the SAME Task source that runs in E2E via `BrowseTheWeb`
 * runs here against a mounted component — only the ability binding differs (ADR-0005).
 *
 * This module is the ONLY place that imports `@playwright/experimental-ct-react`, so the core
 * `screenplay/` package stays free of the CT dependency.
 */
export function createComponentActor(mountResult: MountResult, name = 'Component user'): Actor {
  return Actor.named(name).can(InteractWithComponent.using(mountResult.page()))
}
