/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { RightRail } from './RightRail'

// Organism component test (ADR-0027, composition-delta model): the Badge atom RightRail composes is
// already proven, so these cover only what the RAIL adds — the always-on name/slug header, each
// conditional stat row, the Enabled/Off donations label, and the money-formatted total.

test('renders the community name and slug', async () => {
  const screen = await render(<RightRail name="General" slug="general" />)

  await expect.element(screen.getByText('General', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('/general')).toBeVisible()
})

test('shows the member count and created date when provided', async () => {
  const screen = await render(
    <RightRail
      name="General"
      slug="general"
      memberCount={42}
      createdAt="2026-05-28T12:00:00.000Z"
    />,
  )

  await expect.element(screen.getByText('Members')).toBeVisible()
  await expect.element(screen.getByText('42')).toBeVisible()
  await expect.element(screen.getByText('2026-05-28')).toBeVisible()
})

test('donations enabled shows the Enabled badge', async () => {
  const screen = await render(<RightRail name="General" slug="general" donationsEnabled />)

  await expect.element(screen.getByText('Enabled')).toBeVisible()
})

test('donations disabled shows the Off badge', async () => {
  const screen = await render(<RightRail name="General" slug="general" donationsEnabled={false} />)

  await expect.element(screen.getByText('Off')).toBeVisible()
})

test('shows the raised total formatted as money', async () => {
  const screen = await render(
    <RightRail name="General" slug="general" totalDonationsCents={125000} currency="USD" />,
  )

  await expect.element(screen.getByText('$1,250.00')).toBeVisible()
})

test('omits the optional stat rows when their data is absent', async () => {
  const screen = await render(<RightRail name="General" slug="general" />)

  expect(screen.container.textContent).not.toContain('Members')
  expect(screen.container.textContent).not.toContain('Donations')
  expect(screen.container.textContent).not.toContain('Raised')
})
