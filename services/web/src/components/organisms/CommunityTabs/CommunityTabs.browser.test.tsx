/// <reference types="@vitest/browser/matchers" />

import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { CommunityTabs } from './CommunityTabs'

// Organism component test (ADR-0027, composition-delta model): CommunityTabs composes proven router
// NavLinks. The links' active styling is router behavior; what the organism ADDS is the section tab
// strip — the navigation landmark and the per-section hrefs derived from the community id. Those are
// what this covers. A MemoryRouter supplies the routing context the NavLinks need.

const communityId = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const base = `/c/${communityId}`

test('exposes a Community sections navigation landmark', async () => {
  const screen = await render(
    <MemoryRouter>
      <CommunityTabs communityId={communityId} />
    </MemoryRouter>,
  )

  await expect.element(screen.getByRole('navigation', { name: 'Community sections' })).toBeVisible()
})

test('links each tab to its section beneath the community base path', async () => {
  const screen = await render(
    <MemoryRouter>
      <CommunityTabs communityId={communityId} />
    </MemoryRouter>,
  )

  await expect.element(screen.getByRole('link', { name: 'Feed' })).toHaveAttribute('href', base)
  await expect
    .element(screen.getByRole('link', { name: 'Submit' }))
    .toHaveAttribute('href', `${base}/submit`)
  await expect
    .element(screen.getByRole('link', { name: 'Moderation' }))
    .toHaveAttribute('href', `${base}/mod`)
})
