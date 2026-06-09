import { expect, test } from '../../playwright'
import { ErrProbe, OkProbe, RaceProbe } from './useResource.probe'

// Hook behaviour is tested in the CT tier (ADR-0005: no Vitest DOM rendering). The harness probes
// (imported, since CT only mounts compiled components) drive the hook and project its state to the
// DOM; the test interacts via in-browser clicks (no cross-boundary promise timing) for determinism.

test('loads on mount and exposes the resolved data', async ({ mount }) => {
  const component = await mount(<OkProbe />)
  await expect(component.getByTestId('data')).toHaveText('loaded')
})

test('surfaces a loader rejection through the error field', async ({ mount }) => {
  const component = await mount(<ErrProbe />)
  await expect(component.getByTestId('error')).toHaveText('load failed')
})

test('a superseded slow load never overwrites the latest resource', async ({ mount }) => {
  const component = await mount(<RaceProbe />)
  await component.getByTestId('to-b').click() // A still in flight; B load now started
  await component.getByTestId('resolve-b').click() // latest resolves first
  await expect(component.getByTestId('data')).toHaveText('B-data')
  await component.getByTestId('resolve-a').click() // stale A resolves late — guard must drop it
  await expect(component.getByTestId('data')).toHaveText('B-data')
})
