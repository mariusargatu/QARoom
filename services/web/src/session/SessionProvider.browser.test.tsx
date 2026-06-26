/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_HANDLE, EXAMPLE_USER_ID } from '@qaroom/contracts'
import fc from 'fast-check'
import { Component, type ReactNode } from 'react'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ApiClient } from '../api/client'
import { SessionProvider, useSession } from './SessionProvider'
import { SessionHarness } from './SessionProvider.probe'

// Session behaviour in the browser tier (ADR-0027, supersedes the Playwright-CT version of ADR-0005).
// localStorage is cleared before the app initialises so the roster assertions are deterministic
// regardless of any prior page state. Browser required.

test('signs a user in, dedups the known-users roster, and clears state on logout', async () => {
  localStorage.clear()
  const screen = await render(<SessionHarness />)

  await expect.element(screen.getByTestId('user')).toHaveTextContent('none')

  await screen.getByTestId('signin').click()
  await expect.element(screen.getByTestId('user')).toHaveTextContent('ada')
  await expect.element(screen.getByTestId('known')).toHaveTextContent(/^1$/)

  await screen.getByTestId('signin').click() // same user id — upsertById must not duplicate
  await expect.element(screen.getByTestId('known')).toHaveTextContent(/^1$/)

  await screen.getByTestId('logout').click()
  await expect.element(screen.getByTestId('user')).toHaveTextContent('none')
})

// Bare provider over a stub api (no method is called during these renders) + a tiny probe per concern,
// mirroring the page tests' build-your-own-probe shape. Covers the three branches the sign-in/out flow
// above leaves open: the read() parse-failure fallback, refreshToken's rethrow, and forgetCommunity.

const stubApi = {} as unknown as ApiClient

function RosterProbe() {
  const { knownCommunities, knownUsers } = useSession()
  return (
    <div>
      <span data-testid="communities">{knownCommunities.length}</span>
      <span data-testid="users">{knownUsers.length}</span>
    </div>
  )
}

// read() degrades a corrupt persisted roster to its typed fallback rather than throwing during init.
// Property over guaranteed-unparseable payloads (a leading '~' is never a valid JSON value start) for
// each localStorage-backed roster key: whichever roster is corrupt, the provider mounts and that roster
// resolves to the empty fallback. The render succeeding at all is the proof the JSON.parse throw was
// swallowed (SessionProvider.read line 58); the 0-count is the proof it fell back rather than partially
// populating.
test('an unparseable persisted roster degrades to the empty fallback instead of crashing', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string().map((s) => `~${s}`),
      fc.constantFrom('qaroom.communities', 'qaroom.users'),
      async (garbage, key) => {
        localStorage.clear()
        localStorage.setItem(key, garbage)
        const screen = await render(
          <SessionProvider api={stubApi}>
            <RosterProbe />
          </SessionProvider>,
        )

        await expect.element(screen.getByTestId('communities')).toHaveTextContent(/^0$/)
        await expect.element(screen.getByTestId('users')).toHaveTextContent(/^0$/)

        await screen.unmount()
      },
    ),
    { seed: 4_815_162, numRuns: 24 },
  )
})

function RefreshProbe({ onError }: { onError: (error: unknown) => void }) {
  const { refreshToken } = useSession()
  return (
    <button type="button" data-testid="refresh" onClick={() => void refreshToken().catch(onError)}>
      refresh
    </button>
  )
}

// refreshToken wraps a failing token mint in a NAMED diagnostic and rethrows (it cannot swallow — the
// caller needs to know the membership claim is now stale). Pre-seed a signed-in session so the early
// `if (!session) return` is skipped, then make the api reject: the catch (line 127) must surface a
// 'Failed to refresh session token: …' error carrying the underlying message.
test('refreshToken rethrows a named wrapped error when the token mint rejects', async () => {
  localStorage.clear()
  localStorage.setItem(
    'qaroom.session',
    JSON.stringify({
      token: 'header.payload.sig',
      currentUser: { id: EXAMPLE_USER_ID, handle: EXAMPLE_HANDLE, display_name: 'Ada Lovelace' },
    }),
  )
  let captured: unknown
  const rejectingApi = {
    createSession: async () => {
      throw new Error('gateway down')
    },
  } as unknown as ApiClient
  const screen = await render(
    <SessionProvider api={rejectingApi}>
      <RefreshProbe
        onError={(error) => {
          captured = error
        }}
      />
    </SessionProvider>,
  )

  await screen.getByTestId('refresh').click()

  await vi.waitFor(() => {
    expect(captured).toBeInstanceOf(Error)
    expect((captured as Error).message).toBe('Failed to refresh session token: gateway down')
  })
})

function ForgetProbe() {
  const { knownCommunities, rememberCommunity, forgetCommunity } = useSession()
  return (
    <div>
      <span data-testid="slugs">{knownCommunities.map((c) => c.slug).join(',') || 'none'}</span>
      <button
        type="button"
        data-testid="remember-alpha"
        onClick={() => rememberCommunity({ id: 'comm_alpha', slug: 'alpha', name: 'Alpha' })}
      >
        remember alpha
      </button>
      <button
        type="button"
        data-testid="remember-beta"
        onClick={() => rememberCommunity({ id: 'comm_beta', slug: 'beta', name: 'Beta' })}
      >
        remember beta
      </button>
      <button
        type="button"
        data-testid="forget-alpha"
        onClick={() => forgetCommunity('comm_alpha')}
      >
        forget alpha
      </button>
    </div>
  )
}

// forgetCommunity drops exactly the named id and keeps the rest — exercising both arms of its filter
// predicate (line 135): the matched community is removed, the unmatched one survives.
test('forgetCommunity removes exactly the named community and keeps the rest', async () => {
  localStorage.clear()
  const screen = await render(
    <SessionProvider api={stubApi}>
      <ForgetProbe />
    </SessionProvider>,
  )

  await screen.getByTestId('remember-beta').click()
  await screen.getByTestId('remember-alpha').click() // upsert prepends → alpha,beta
  await expect.element(screen.getByTestId('slugs')).toHaveTextContent('alpha,beta')

  await screen.getByTestId('forget-alpha').click()
  await expect.element(screen.getByTestId('slugs')).toHaveTextContent(/^beta$/)
})

function NoSessionRefreshProbe({ onSettled }: { onSettled: () => void }) {
  const { refreshToken } = useSession()
  return (
    <button type="button" data-testid="refresh" onClick={() => void refreshToken().then(onSettled)}>
      refresh
    </button>
  )
}

// refreshToken's `if (!session) return` guard (line 122): with no session the call is a resolved
// no-op — it must NOT reach the api (there is no identity whose token could be minted). Asserts the
// promise settles AND the token endpoint was never touched, closing the early-return arm.
test('refreshToken is a no-op when logged out and never calls the token api', async () => {
  localStorage.clear()
  let settled = false
  let createSessionCalls = 0
  const spyingApi = {
    createSession: async () => {
      createSessionCalls += 1
      return { access_token: 'header.payload.sig' }
    },
  } as unknown as ApiClient
  const screen = await render(
    <SessionProvider api={spyingApi}>
      <NoSessionRefreshProbe
        onSettled={() => {
          settled = true
        }}
      />
    </SessionProvider>,
  )

  await screen.getByTestId('refresh').click()

  await vi.waitFor(() => expect(settled).toBe(true))
  expect(createSessionCalls).toBe(0)
})

// useSession() outside a <SessionProvider> is a programming error: the hook throws a NAMED diagnostic
// (line 181's `!ctx` arm) rather than returning null and crashing later. A render error boundary
// captures the render-time throw — mirrors the ThemeProvider provider-not-found test.
class CaptureBoundary extends Component<
  { onError: (error: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error)
  }
  override render() {
    return this.state.failed ? <span data-testid="caught">caught</span> : this.props.children
  }
}

test('useSession() outside a SessionProvider throws a named diagnostic', async () => {
  let captured: Error | undefined
  const screen = await render(
    <CaptureBoundary
      onError={(error) => {
        captured = error
      }}
    >
      <RosterProbe />
    </CaptureBoundary>,
  )

  await expect.element(screen.getByTestId('caught')).toBeVisible()
  expect(captured?.message).toBe('useSession must be used within a SessionProvider')
})
