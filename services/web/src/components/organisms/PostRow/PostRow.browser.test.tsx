/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_POST } from '@qaroom/contracts'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { PostRow } from './PostRow'

// Organism component test (ADR-0027, composition-delta model): the VoteControl molecule PostRow
// composes is already proven, so these cover only what the ROW adds — the title link, the author
// resolution (display name, else a shortened id), the date meta line, and the optional excerpt.

test('renders the title as a link to the post detail route', async () => {
  const screen = await render(
    <MemoryRouter>
      <PostRow
        post={EXAMPLE_POST}
        to="/c/general/p/post_1"
        authorName="Ada Lovelace"
        onVote={vi.fn()}
      />
    </MemoryRouter>,
  )

  await expect
    .element(screen.getByRole('link', { name: 'Why deterministic clocks matter' }))
    .toHaveAttribute('href', '/c/general/p/post_1')
})

test('shows the resolved author name and the post date in the meta line', async () => {
  const screen = await render(
    <MemoryRouter>
      <PostRow post={EXAMPLE_POST} to="/x" authorName="Ada Lovelace" onVote={vi.fn()} />
    </MemoryRouter>,
  )

  expect(screen.container.textContent).toContain('Ada Lovelace')
  expect(screen.container.textContent).toContain('2026-05-28')
})

test('falls back to a shortened author id when no display name is given', async () => {
  const screen = await render(
    <MemoryRouter>
      <PostRow post={EXAMPLE_POST} to="/x" onVote={vi.fn()} />
    </MemoryRouter>,
  )

  expect(screen.container.textContent).toContain('user_…B4CF')
  expect(screen.container.textContent).not.toContain(EXAMPLE_POST.author_id)
})

test('renders the post body as an excerpt', async () => {
  const screen = await render(
    <MemoryRouter>
      <PostRow post={EXAMPLE_POST} to="/x" authorName="Ada" onVote={vi.fn()} />
    </MemoryRouter>,
  )

  await expect.element(screen.getByText('A short note on testability.')).toBeVisible()
})

test('omits the excerpt when the post has no body', async () => {
  const screen = await render(
    <MemoryRouter>
      <PostRow post={{ ...EXAMPLE_POST, body: '' }} to="/x" authorName="Ada" onVote={vi.fn()} />
    </MemoryRouter>,
  )

  expect(screen.container.textContent).not.toContain('A short note on testability.')
})
