/// <reference types="@vitest/browser/matchers" />

import { Component, type ReactNode } from 'react'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { useApi } from './ApiProvider'

// ApiProvider context contract (ADR-0027): calling useApi() OUTSIDE an <ApiProvider> is a programming
// error, and the hook must throw a NAMED diagnostic at the point of misuse rather than return null and
// crash opaquely later at a `ctx.api.x` dereference. A render error boundary captures the render-time
// throw so the assertion can read its message; without the boundary the throw would fail the suite.

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

function ApiProbe() {
  useApi()
  return <span data-testid="unreachable">unreachable</span>
}

test('useApi() outside an ApiProvider throws a named diagnostic', async () => {
  let captured: Error | undefined
  const screen = await render(
    <CaptureBoundary
      onError={(error) => {
        captured = error
      }}
    >
      <ApiProbe />
    </CaptureBoundary>,
  )

  await expect.element(screen.getByTestId('caught')).toBeVisible()
  expect(captured?.message).toBe('useApi must be used within an ApiProvider')
})
