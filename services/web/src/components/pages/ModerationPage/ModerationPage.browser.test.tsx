/// <reference types="@vitest/browser/matchers" />
import {
  EXAMPLE_AS_OF,
  EXAMPLE_MODERATION_DECISION,
  ModerationDecisionList,
} from '@qaroom/contracts'
import { Route, Routes } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { type WithProvidersOpts, withProviders } from '../../../test-support/with-providers'
import { ModerationPage } from './ModerationPage'

// Page composition-delta test (ADR-0027): ModerationPage reads the `useModeration` hook and either
// shows the proven ErrorState molecule OR wires the proven ModerationDecisionList organism with the
// hook's decisions. The tests cover ONLY the page's own delta — the error-vs-content split and that
// the loaded/loading decisions flow into the ledger. The DecisionCard's disposition/confidence/
// citation formatting is proven in its own test and is not re-asserted here.

const moderationRoute = (api: WithProvidersOpts['api']) =>
  withProviders(
    <Routes>
      <Route path="/c/:communityId/mod" element={<ModerationPage />} />
    </Routes>,
    { path: '/c/comm_x/mod', api },
  )

test('the recorded decisions flow into the ledger (the organism is wired in)', async () => {
  const screen = await render(
    moderationRoute({
      listModerationDecisions: async () =>
        ModerationDecisionList.parse({
          decisions: [{ ...EXAMPLE_MODERATION_DECISION, rationale: 'Within the guidelines.' }],
          as_of: EXAMPLE_AS_OF,
        }),
    }),
  )

  await expect.element(screen.getByText('Within the guidelines.')).toBeVisible()
})

test('a moderation load error surfaces the retryable error panel instead of the ledger', async () => {
  const screen = await render(
    moderationRoute({
      listModerationDecisions: async () => {
        throw new Error('moderator upstream down')
      },
    }),
  )

  await expect.element(screen.getByText('moderator upstream down')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('pressing Try again re-runs the load and the recovered decisions replace the error panel', async () => {
  const listModerationDecisions = vi
    .fn()
    .mockRejectedValueOnce(new Error('moderator upstream down'))
    .mockResolvedValue(
      ModerationDecisionList.parse({
        decisions: [{ ...EXAMPLE_MODERATION_DECISION, rationale: 'Cleared on retry.' }],
        as_of: EXAMPLE_AS_OF,
      }),
    )
  const screen = await render(moderationRoute({ listModerationDecisions }))

  await expect.element(screen.getByText('moderator upstream down')).toBeVisible()
  await screen.getByRole('button', { name: 'Try again' }).click()

  await expect.element(screen.getByText('Cleared on retry.')).toBeVisible()
  await expect.element(screen.getByText('moderator upstream down')).not.toBeInTheDocument()
  expect(listModerationDecisions).toHaveBeenCalledTimes(2)
})

test('while the decisions are loading the ledger region is marked busy', async () => {
  const screen = await render(
    moderationRoute({
      listModerationDecisions: () => new Promise<ModerationDecisionList>(() => {}),
    }),
  )

  await expect.element(screen.getByRole('heading', { name: 'Moderation' })).toBeVisible()
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
})
