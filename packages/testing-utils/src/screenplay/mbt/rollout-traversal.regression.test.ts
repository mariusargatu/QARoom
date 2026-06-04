import { rolloutMachine } from '@qaroom/contracts'
import { createTestModel } from '@xstate/graph'
import { describe, expect, it } from 'vitest'
import { fromPromise, setup } from 'xstate'
import { assertPathCount, shortestPaths, simplePaths } from './generate-paths'
import { assertModelMatchesSystem, modeledStates } from './model-validation'

// This file pins the two @xstate/graph 3.0.4 constraints the whole MBT story rests on
// (ADR-0005). If a version bump or a machine edit breaks either, this fails loudly.

describe('the rollout model is @xstate/graph-traversable', () => {
  it('generates shortest paths reaching every one of the five reachable states', () => {
    const paths = shortestPaths(rolloutMachine, { maxDepth: 10 })
    const targets = new Set(paths.map((p) => p.target))
    expect(targets.size).toBe(modeledStates(rolloutMachine).length)
    expect(modeledStates(rolloutMachine).length).toBe(5)
  })

  it('generates simple paths and stays within a sane count band', () => {
    const paths = simplePaths(rolloutMachine, { maxDepth: 20 })
    // Floor catches a regression that erases reachable states; cap catches an explosion.
    assertPathCount(paths, { floor: 5, cap: 200 })
  })

  it('fails the path-count floor when the model would have shrunk', () => {
    expect(() => assertPathCount([], { floor: 5, cap: 50 })).toThrow(/below the floor/)
  })
})

describe('the invoke/after rejection is real (not folklore)', () => {
  it('throws when asked to traverse a machine that uses invoke', () => {
    const invokeMachine = setup({
      actors: { noop: fromPromise(async () => undefined) },
    }).createMachine({
      id: 'invoked',
      initial: 'Working',
      states: {
        Working: { invoke: { src: 'noop', onDone: 'Done' } },
        Done: {},
      },
    })
    expect(() => createTestModel(invokeMachine).getShortestPaths()).toThrow()
  })
})

describe('the model-validation guard', () => {
  it('passes when the system reports the model initial state and supports every event', () => {
    expect(() =>
      assertModelMatchesSystem(rolloutMachine, {
        initialState: 'Off',
        supportedEvents: [
          'EnableRequested',
          'CanaryConfirmed',
          'RolloutCompleted',
          'DisableRequested',
          'DisableCompleted',
          'RolloutAborted',
        ],
      }),
    ).not.toThrow()
  })

  it('fails when a modeled event has no system endpoint', () => {
    expect(() =>
      assertModelMatchesSystem(rolloutMachine, {
        initialState: 'Off',
        supportedEvents: ['EnableRequested'],
      }),
    ).toThrow(/no system endpoint/)
  })

  it('fails when the system reports a different initial state', () => {
    expect(() =>
      assertModelMatchesSystem(rolloutMachine, { initialState: 'Enabled', supportedEvents: [] }),
    ).toThrow(/initial-state mismatch/)
  })
})
