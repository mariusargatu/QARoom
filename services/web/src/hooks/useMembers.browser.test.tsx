import type { ReactNode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import { SessionProvider } from '../session/SessionProvider'
import { useMembers } from './useMembers'

// Hook test (ADR-0027): useMembers reads useSession, so it renders inside a SessionProvider wrapper.
// Its own delta over the shared useResource is the addMember mutation (grant then refresh) and its
// separate adding/addError state. With no seeded session `currentUser` is null, so the token-refresh
// branch stays out of the way and the data-fake's `addMembership` + `listMembers` drive the flow.

const sessionApi = {} as unknown as ApiClient
function SessionWrapper({ children }: { children: ReactNode }) {
  return <SessionProvider api={sessionApi}>{children}</SessionProvider>
}

beforeEach(() => {
  localStorage.clear()
})

test("the roster loads a community's members on mount", async () => {
  const members = [{ id: 'mem_1' }]
  const listMembers = vi.fn(async () => ({ members }))
  const api = { listMembers } as unknown as ApiClient
  const { result } = await renderHook(() => useMembers(api, 'comm_1'), { wrapper: SessionWrapper })

  await vi.waitFor(() => expect(result.current.members).toEqual(members))
  expect(listMembers).toHaveBeenCalledWith('comm_1')
})

test('addMember grants the role then refreshes the roster', async () => {
  const granted = { id: 'mem_2' }
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce({ members: [] })
    .mockResolvedValue({ members: [granted] })
  const addMembership = vi.fn(async () => granted)
  const api = { listMembers, addMembership } as unknown as ApiClient
  const { result } = await renderHook(() => useMembers(api, 'comm_1'), { wrapper: SessionWrapper })

  await vi.waitFor(() => expect(result.current.members).toEqual([]))
  await result.current.addMember('user_2', 'member')

  expect(addMembership).toHaveBeenCalledWith('comm_1', { user_id: 'user_2', role: 'member' })
  await vi.waitFor(() => expect(result.current.members).toEqual([granted]))
})

test('granting yourself a role refreshes the session token before reloading the roster', async () => {
  // Seed a session whose currentUser is the very user being granted, so the self-grant branch fires:
  // `userId === currentUser?.id` is true and addMember must call refreshToken (the membership claim
  // in the JWT changed). refreshToken lives on the SessionProvider's own api, so this wrapper supplies
  // a createSession; the empty-session SessionWrapper above keeps the false arm covered.
  const self = { id: 'user_self', handle: 'me', display_name: 'Me' }
  localStorage.setItem('qaroom.session', JSON.stringify({ token: 'seed', currentUser: self }))
  const createSession = vi.fn(async () => ({ access_token: 'fresh' }))
  const sessionWithUser = { createSession } as unknown as ApiClient
  function SelfSessionWrapper({ children }: { children: ReactNode }) {
    return <SessionProvider api={sessionWithUser}>{children}</SessionProvider>
  }

  const granted = { id: self.id }
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce({ members: [] })
    .mockResolvedValue({ members: [granted] })
  const addMembership = vi.fn(async () => granted)
  const api = { listMembers, addMembership } as unknown as ApiClient
  const { result } = await renderHook(() => useMembers(api, 'comm_1'), {
    wrapper: SelfSessionWrapper,
  })

  await vi.waitFor(() => expect(result.current.members).toEqual([]))
  await result.current.addMember(self.id, 'moderator')

  expect(addMembership).toHaveBeenCalledWith('comm_1', { user_id: self.id, role: 'moderator' })
  expect(createSession).toHaveBeenCalledWith(self.id) // self-grant fired a token refresh
  await vi.waitFor(() => expect(result.current.members).toEqual([granted]))
})

test('an addMember failure surfaces through addError and clears adding', async () => {
  const listMembers = vi.fn(async () => ({ members: [] }))
  const addMembership = async () => {
    throw new Error('not authorized')
  }
  const api = { listMembers, addMembership } as unknown as ApiClient
  const { result } = await renderHook(() => useMembers(api, 'comm_1'), { wrapper: SessionWrapper })

  await result.current.addMember('user_2', 'member')

  await vi.waitFor(() => expect(result.current.addError).toBeTruthy())
  expect(result.current.adding).toBe(false)
})
