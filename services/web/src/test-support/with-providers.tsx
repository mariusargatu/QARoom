import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ApiProvider } from '../api/ApiProvider'
import type { ApiClient } from '../api/client'
import { SessionProvider } from '../session/SessionProvider'
import { ThemeProvider } from '../theme/ThemeProvider'

/** A fake `ApiClient` — pages/hooks call only the few methods a given test needs, so cast the partial. */
export function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return overrides as ApiClient
}

/** Options for {@link withProviders}; exported so tests can type a `route(api)` helper cleanly. */
export interface WithProvidersOpts {
  path?: string
  api?: Partial<ApiClient>
}

/**
 * Wrap a page (or any session/router/api-dependent component) in the app's providers for a browser
 * test: `ApiProvider` (fake client — pages read it via `useApi()`) + `SessionProvider` (seeded from
 * localStorage — set `qaroom.session` before rendering to drive the signed-in branch) over a
 * `MemoryRouter`. Add `<Routes>` inside `children` to assert a redirect's destination. Reference shape
 * for the page composition-delta tests (ADR-0027). Pass `opts.api` with just the methods the page calls.
 */
export function withProviders(children: ReactNode, opts: WithProvidersOpts = {}): ReactElement {
  const client = fakeApi(opts.api)
  return (
    <ApiProvider api={client} baseUrl="">
      <ThemeProvider initial="light">
        <SessionProvider api={client}>
          <MemoryRouter initialEntries={[opts.path ?? '/']}>{children}</MemoryRouter>
        </SessionProvider>
      </ThemeProvider>
    </ApiProvider>
  )
}
