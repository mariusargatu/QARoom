import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ApiClient } from '../api/client'
import { SessionProvider } from '../session/SessionProvider'
import { RequireSession } from './RequireSession'

// Harness for RequireSession.browser.test.tsx (ADR-0027). The session is read from localStorage by
// SessionProvider on init, so the test seeds (or clears) it directly (the test runs in the browser)
// BEFORE render to drive the guard down each branch. The fake ApiClient is never
// called on a static render — it only stands in for the constructor dependency.

const fakeApi = (): ApiClient => ({}) as unknown as ApiClient

/**
 * Mounts RequireSession guarding a `/protected` route, starting AT `/protected`. With a session the
 * guard renders the protected child; without one it redirects to `/login`. The visible screen is
 * the single observable both tests assert on.
 */
export function GuardedRoutes() {
  return (
    <SessionProvider api={fakeApi()}>
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div data-testid="screen">login</div>} />
          <Route element={<RequireSession />}>
            <Route path="/protected" element={<div data-testid="screen">protected</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>
  )
}
