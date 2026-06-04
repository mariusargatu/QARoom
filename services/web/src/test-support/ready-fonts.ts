import type { MountResult } from '@playwright/experimental-ct-react'

/**
 * Wait for web fonts before a visual assertion so screenshots are stable. Playwright CT requires the
 * component JSX to be STATIC at the `mount()` call site (a runtime `createElement` is rejected with
 * "Object mount notation is not supported"), so each `.ct.tsx` mounts the raw component spread
 * directly — `mount(<Component {...story.args} />)` (ADR-0005; the `no-mount-composed-story` lint rule
 * forbids mounting a `composeStories()` result) — and passes the result here for the fonts wait.
 */
export async function readyFonts(mounted: MountResult): Promise<MountResult> {
  await mounted.page().evaluate(() => document.fonts.ready)
  return mounted
}
