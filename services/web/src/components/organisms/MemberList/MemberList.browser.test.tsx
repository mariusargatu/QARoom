/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_MEMBERSHIP, Membership } from '@qaroom/contracts'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { MemberList } from './MemberList'

// Organism component test (ADR-0027, composition-delta model): MemberList composes the proven
// Avatar/Badge/Skeleton atoms. These cover only what the ORGANISM adds — one row per member carrying
// its role badge, plus the loading-vs-empty fallbacks the list owns. The atoms' rendering is not
// re-asserted; the role text is read only to prove the list mapped each membership to a row.

test('renders one row per member, each carrying its role', async () => {
  const members = [
    Membership.parse({ ...EXAMPLE_MEMBERSHIP, role: 'owner' }),
    Membership.parse({
      ...EXAMPLE_MEMBERSHIP,
      user_id: 'user_01HZY0K7M3QF8VN2J5RX9TB4CG',
      role: 'member',
    }),
  ]
  const screen = await render(<MemberList members={members} />)

  await expect.element(screen.getByText('owner')).toBeVisible()
  await expect.element(screen.getByText('member')).toBeVisible()
})

test('the empty roster invites adding the first member', async () => {
  const screen = await render(<MemberList members={[]} />)

  await expect.element(screen.getByText('No members yet')).toBeVisible()
})

test('the loading roster marks its region busy', async () => {
  await render(<MemberList members={[]} loading />)

  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
})
