/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { PostList } from './PostList'

// Organism component test (ADR-0027, composition-delta model): PostList owns only the
// loading/empty/children switch around the rows the page supplies (the Skeleton atom and the
// injected emptyState node are already proven). These tests cover that switch and nothing else.

test('the loading state shows a busy placeholder instead of the children', async () => {
  const screen = await render(
    <PostList loading>
      <article>a real post row</article>
    </PostList>,
  )

  expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(screen.container.textContent).not.toContain('a real post row')
})

test('the empty state renders the supplied empty node instead of the children', async () => {
  const screen = await render(
    <PostList isEmpty emptyState={<p>No posts yet</p>}>
      <article>a real post row</article>
    </PostList>,
  )

  await expect.element(screen.getByText('No posts yet')).toBeVisible()
  expect(screen.container.textContent).not.toContain('a real post row')
})

test('the children render when the list is neither loading nor empty', async () => {
  const screen = await render(
    <PostList>
      <article>a real post row</article>
    </PostList>,
  )

  await expect.element(screen.getByText('a real post row')).toBeVisible()
})
