/// <reference types="@vitest/browser/matchers" />
import {
  EXAMPLE_AS_OF,
  EXAMPLE_COMMUNITY_ID,
  EXAMPLE_MEMBERSHIP,
  EXAMPLE_USER_ID,
  MemberList,
  type Membership,
} from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { shortId } from '../../../lib/format'
import { type WithProvidersOpts, withProviders } from '../../../test-support/with-providers'
import { MembersPage } from './MembersPage'

// Page composition-delta test (ADR-0027): MembersPage composes TWO proven organisms — MemberList
// (behind the hook's error/content split) and the always-present AddMemberForm. The tests cover only
// the page's own delta: the roster data flowing into the list, the add form being wired in regardless,
// and that a load error swaps the list for ErrorState WITHOUT hiding the add form. The roster row's
// avatar/role-badge rendering is proven in MemberList's own test and is not re-asserted here.

const membersRoute = (api: WithProvidersOpts['api']) =>
  withProviders(
    <Routes>
      <Route path="/c/:communityId/members" element={<MembersPage />} />
    </Routes>,
    { path: '/c/comm_x/members', api },
  )

test('the loaded roster flows into the member list (the organism is wired in)', async () => {
  const screen = await render(
    membersRoute({
      listMembers: async () =>
        MemberList.parse({
          community_id: EXAMPLE_COMMUNITY_ID,
          members: [EXAMPLE_MEMBERSHIP],
          as_of: EXAMPLE_AS_OF,
        }),
    }),
  )

  await expect.element(screen.getByText(shortId(EXAMPLE_USER_ID))).toBeVisible()
})

test('the add-member form is wired in alongside the roster', async () => {
  const screen = await render(
    membersRoute({
      listMembers: async () =>
        MemberList.parse({ community_id: EXAMPLE_COMMUNITY_ID, members: [], as_of: EXAMPLE_AS_OF }),
    }),
  )

  await expect.element(screen.getByRole('button', { name: 'Add member' })).toBeVisible()
})

test('a roster load error swaps the list for the error panel but keeps the add form', async () => {
  const screen = await render(
    membersRoute({
      listMembers: async () => {
        throw new Error('roster upstream down')
      },
    }),
  )

  await expect.element(screen.getByText('roster upstream down')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Add member' })).toBeVisible()
})

const emptyRoster = async () =>
  MemberList.parse({ community_id: EXAMPLE_COMMUNITY_ID, members: [], as_of: EXAMPLE_AS_OF })
const oneRoster = async () =>
  MemberList.parse({
    community_id: EXAMPLE_COMMUNITY_ID,
    members: [EXAMPLE_MEMBERSHIP],
    as_of: EXAMPLE_AS_OF,
  })

test('submitting the add-member form grants the entered user the default role', async () => {
  localStorage.clear()
  const addMembership = vi.fn(async () => EXAMPLE_MEMBERSHIP as unknown as Membership)
  const screen = await render(membersRoute({ listMembers: emptyRoster, addMembership }))

  await screen.getByPlaceholder('user_…').fill(EXAMPLE_USER_ID)
  await screen.getByRole('button', { name: 'Add member' }).click()

  await vi.waitFor(() =>
    expect(addMembership).toHaveBeenCalledWith('comm_x', {
      user_id: EXAMPLE_USER_ID,
      role: 'member',
    }),
  )
})

test('a failed add surfaces the inline add error', async () => {
  localStorage.clear()
  const addMembership = vi.fn(async () => {
    throw new Error('not permitted')
  })
  const screen = await render(membersRoute({ listMembers: emptyRoster, addMembership }))

  await screen.getByPlaceholder('user_…').fill(EXAMPLE_USER_ID)
  await screen.getByRole('button', { name: 'Add member' }).click()

  await expect.element(screen.getByText('not permitted')).toBeVisible()
})

test('retrying a failed roster load recovers the member list', async () => {
  localStorage.clear()
  const listMembers = vi.fn(oneRoster).mockRejectedValueOnce(new Error('roster offline'))
  const screen = await render(membersRoute({ listMembers }))

  await screen.getByRole('button', { name: 'Try again' }).click()

  await expect.element(screen.getByText(shortId(EXAMPLE_USER_ID))).toBeVisible()
})
