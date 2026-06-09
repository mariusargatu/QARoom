import type { ApiClient } from '../api/client'
import { SessionProvider, useSession } from './SessionProvider'

// CT harness for SessionProvider.ct.tsx (Playwright CT mounts only imported components). A minimal
// fake ApiClient stands in for the gateway: only the session-bootstrap surface is exercised.

function fakeApi(): ApiClient {
  return {
    createSession: async () => ({
      session_id: 'sess_01HZY0K7M3QF8VN2J5RX9TB4CG',
      access_token: 'header.payload.sig',
      token_type: 'Bearer',
      expires_at: '2026-01-01T00:15:00.000Z',
      kid: 'key_01HZY0K7M3QF8VN2J5RX9TB4CD',
    }),
    getUser: async (userId: string) => ({
      id: userId,
      handle: 'ada',
      display_name: 'Ada Lovelace',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  } as unknown as ApiClient
}

/** Drives the session context: sign in a known user id, sign in again (dedup), and log out. */
function Inner() {
  const session = useSession()
  return (
    <div>
      <div data-testid="user">{session.currentUser?.handle ?? 'none'}</div>
      <div data-testid="known">{session.knownUsers.length}</div>
      <button
        type="button"
        data-testid="signin"
        onClick={() => void session.signIn('user_01HZY0K7M3QF8VN2J5RX9TB4CF')}
      >
        sign in
      </button>
      <button type="button" data-testid="logout" onClick={session.logout}>
        log out
      </button>
    </div>
  )
}

export function SessionHarness() {
  return (
    <SessionProvider api={fakeApi()}>
      <Inner />
    </SessionProvider>
  )
}
