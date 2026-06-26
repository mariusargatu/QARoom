/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_MODERATION_DECISION, ModerationDecision } from '@qaroom/contracts'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { ModerationDecisionList } from './ModerationDecisionList'

// Organism component test (ADR-0027, composition-delta model): ModerationDecisionList wraps the proven
// DecisionCard organism + Skeleton atom. These cover only what the LIST adds — stacking one card per
// decision and the loading-vs-empty fallbacks it owns. DecisionCard's internal formatting (disposition
// badge, confidence, citations) is not re-asserted; two distinct rationales are used only to prove the
// list rendered a card for each decision.

test('stacks one card per decision', async () => {
  const decisions = [
    ModerationDecision.parse({
      ...EXAMPLE_MODERATION_DECISION,
      rationale: 'Within the guidelines.',
    }),
    ModerationDecision.parse({
      ...EXAMPLE_MODERATION_DECISION,
      decision_id: 'mdec_01HZY0K7M3QF8VN2J5RX9TB4CR',
      rationale: 'Removed for harassment.',
    }),
  ]
  const screen = await render(<ModerationDecisionList decisions={decisions} />)

  await expect.element(screen.getByText('Within the guidelines.')).toBeVisible()
  await expect.element(screen.getByText('Removed for harassment.')).toBeVisible()
})

test('the empty ledger explains when decisions appear', async () => {
  const screen = await render(<ModerationDecisionList decisions={[]} />)

  await expect.element(screen.getByText('No moderation decisions yet')).toBeVisible()
})

test('the loading ledger marks its region busy', async () => {
  await render(<ModerationDecisionList decisions={[]} loading />)

  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
})
