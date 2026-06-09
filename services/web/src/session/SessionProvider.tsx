import type { MembershipClaim } from '@qaroom/contracts'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ApiClient } from '../api/client'
import { messageFor } from '../lib/errors'
import { decodeAccessTokenClaims } from './jwt'

/** A picked identity (no password — demo identity boundary, ADR-0022). */
export interface UserSummary {
  id: string
  handle: string
  display_name: string
}
/** A community we know the name of — only the ones we created/joined (no listCommunities endpoint). */
export interface CommunitySummary {
  id: string
  slug: string
  name: string
}

interface PersistedSession {
  token: string
  currentUser: UserSummary
}

interface SessionValue {
  token: string | null
  currentUser: UserSummary | null
  memberships: MembershipClaim[]
  knownUsers: UserSummary[]
  knownCommunities: CommunitySummary[]
  signUp(handle: string, displayName: string): Promise<void>
  signIn(userId: string): Promise<void>
  logout(): void
  refreshToken(): Promise<void>
  rememberCommunity(community: CommunitySummary): void
  forgetCommunity(communityId: string): void
}

const SessionContext = createContext<SessionValue | null>(null)

const SESSION_KEY = 'qaroom.session'
const USERS_KEY = 'qaroom.users'
const COMMUNITIES_KEY = 'qaroom.communities'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  return [item, ...list.filter((entry) => entry.id !== item.id)]
}

/**
 * Holds the demo identity + the client-side rosters localStorage backs (known users + communities,
 * since the backend has no listUsers/listCommunities). `memberships` is decoded from the JWT for
 * nav. All mutations go through the injected `ApiClient`.
 */
export function SessionProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [session, setSession] = useState<PersistedSession | null>(() =>
    read<PersistedSession | null>(SESSION_KEY, null),
  )
  const [knownUsers, setKnownUsers] = useState<UserSummary[]>(() =>
    read<UserSummary[]>(USERS_KEY, []),
  )
  const [knownCommunities, setKnownCommunities] = useState<CommunitySummary[]>(() =>
    read<CommunitySummary[]>(COMMUNITIES_KEY, []),
  )

  useEffect(() => {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  }, [session])
  useEffect(() => {
    localStorage.setItem(USERS_KEY, JSON.stringify(knownUsers))
  }, [knownUsers])
  useEffect(() => {
    localStorage.setItem(COMMUNITIES_KEY, JSON.stringify(knownCommunities))
  }, [knownCommunities])

  const startSession = useCallback(
    async (user: UserSummary) => {
      const tokenResponse = await api.createSession(user.id)
      setSession({ token: tokenResponse.access_token, currentUser: user })
      setKnownUsers((prev) => upsertById(prev, user))
    },
    [api],
  )

  const signUp = useCallback(
    async (handle: string, displayName: string) => {
      const user = await api.createUser({ handle, display_name: displayName })
      await startSession({ id: user.id, handle: user.handle, display_name: user.display_name })
    },
    [api, startSession],
  )

  const signIn = useCallback(
    async (userId: string) => {
      const known = knownUsers.find((u) => u.id === userId)
      const user = known ?? (await fetchSummary(api, userId))
      await startSession(user)
    },
    [api, knownUsers, startSession],
  )

  const logout = useCallback(() => setSession(null), [])

  const refreshToken = useCallback(async () => {
    if (!session) return
    try {
      const tokenResponse = await api.createSession(session.currentUser.id)
      setSession({ token: tokenResponse.access_token, currentUser: session.currentUser })
    } catch (error) {
      throw new Error(`Failed to refresh session token: ${messageFor(error)}`)
    }
  }, [api, session])

  const rememberCommunity = useCallback((community: CommunitySummary) => {
    setKnownCommunities((prev) => upsertById(prev, community))
  }, [])
  const forgetCommunity = useCallback((communityId: string) => {
    setKnownCommunities((prev) => prev.filter((c) => c.id !== communityId))
  }, [])

  const memberships = useMemo<MembershipClaim[]>(
    () => (session ? (decodeAccessTokenClaims(session.token)?.memberships ?? []) : []),
    [session],
  )

  const value = useMemo<SessionValue>(
    () => ({
      token: session?.token ?? null,
      currentUser: session?.currentUser ?? null,
      memberships,
      knownUsers,
      knownCommunities,
      signUp,
      signIn,
      logout,
      refreshToken,
      rememberCommunity,
      forgetCommunity,
    }),
    [
      session,
      memberships,
      knownUsers,
      knownCommunities,
      signUp,
      signIn,
      logout,
      refreshToken,
      rememberCommunity,
      forgetCommunity,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

async function fetchSummary(api: ApiClient, userId: string): Promise<UserSummary> {
  const user = await api.getUser(userId)
  return { id: user.id, handle: user.handle, display_name: user.display_name }
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within a SessionProvider')
  return ctx
}
