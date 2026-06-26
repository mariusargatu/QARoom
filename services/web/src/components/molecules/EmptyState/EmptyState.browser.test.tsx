/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { EmptyState } from './EmptyState'

// Molecule component test (ADR-0027, composition-delta): EmptyState wraps the proven Card atom; this
// covers only its own composition — rendering the title/description text and the optional action slot.

test('renders its title and description', async () => {
  const screen = await render(
    <EmptyState title="No posts yet" description="Be the first to post in this community." />,
  )

  await expect.element(screen.getByText('No posts yet')).toBeVisible()
  await expect.element(screen.getByText('Be the first to post in this community.')).toBeVisible()
})

test('renders the action slot when provided', async () => {
  const screen = await render(
    <EmptyState title="No posts yet" action={<button type="button">Create a post</button>} />,
  )

  await expect.element(screen.getByRole('button', { name: 'Create a post' })).toBeVisible()
})
