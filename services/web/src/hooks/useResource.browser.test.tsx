/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { ErrProbe, OkProbe, RaceProbe, RaceRejectProbe } from './useResource.probe'

// Hook behaviour, tested in the browser tier (ADR-0027, supersedes the Playwright-CT version of
// ADR-0005). The harness probes drive the hook and project its state to the DOM; the test interacts
// via real in-browser clicks (no cross-boundary promise timing) for determinism. Browser required.

test('loads on mount and exposes the resolved data', async () => {
  const screen = await render(<OkProbe />)
  await expect.element(screen.getByTestId('data')).toHaveTextContent('loaded')
})

test('surfaces a loader rejection through the error field', async () => {
  const screen = await render(<ErrProbe />)
  await expect.element(screen.getByTestId('error')).toHaveTextContent('load failed')
})

test('a superseded slow load never overwrites the latest resource', async () => {
  const screen = await render(<RaceProbe />)
  await screen.getByTestId('to-b').click() // A still in flight; B load now started
  await screen.getByTestId('resolve-b').click() // latest resolves first
  await expect.element(screen.getByTestId('data')).toHaveTextContent('B-data')
  await screen.getByTestId('resolve-a').click() // stale A resolves late — guard must drop it
  await expect.element(screen.getByTestId('data')).toHaveTextContent('B-data')
})

test('a superseded slow load that rejects late never surfaces its error', async () => {
  const screen = await render(<RaceRejectProbe />)
  await screen.getByTestId('to-b').click() // A still in flight; B load now started
  await screen.getByTestId('resolve-b').click() // latest resolves first -> B-data, no error
  await expect.element(screen.getByTestId('data')).toHaveTextContent('B-data')
  await screen.getByTestId('reject-a').click() // stale A rejects late — guard must drop the error
  await expect.element(screen.getByTestId('error')).toHaveTextContent('no-error')
})
