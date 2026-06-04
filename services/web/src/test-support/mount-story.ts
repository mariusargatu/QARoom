import type { MountResult } from '@playwright/experimental-ct-react'
import { type ComponentType, createElement, type ReactElement } from 'react'

/** A Playwright Component Test `mount` fixture. */
export type MountFn = (component: ReactElement) => Promise<MountResult>

/**
 * Mount the RAW component spread with a story's `args` (NEVER a `composeStories()` result —
 * ADR-0005), then wait for fonts so a subsequent visual assertion is stable. The ~repeated CT
 * idiom lives here once; callers read `story.args` via `composeStories` and pass them in.
 */
export async function mountStory<P extends object>(
  mount: MountFn,
  Component: ComponentType<P>,
  args: P,
): Promise<MountResult> {
  const result = await mount(createElement(Component, args))
  await result.page().evaluate(() => document.fonts.ready)
  return result
}
