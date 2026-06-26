/// <reference types="@vitest/browser/matchers" />
import { EXAMPLE_MODERATION_DECISION, ModerationDecision } from '@qaroom/contracts'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { DecisionCard } from './DecisionCard'

// Organism component test (ADR-0027, composition-delta model): DecisionCard composes the proven Badge
// atom. What the organism ADDS is the disposition->label mapping, the rounded confidence, the
// conditional precedent-departure flag, and the cited-rules / precedents sections. Those are covered;
// the Badge's own rendering is not re-asserted.

const approve = ModerationDecision.parse(EXAMPLE_MODERATION_DECISION)

const remove = ModerationDecision.parse({
  ...EXAMPLE_MODERATION_DECISION,
  disposition: 'remove',
  confidence: 0.91,
  cited_rules: ['no-harassment'],
  precedents: ['remove (no-harassment): a prior slur removal'],
  rationale: 'Targets an individual with a slur, matching the cited no-harassment rule.',
})

const escalate = ModerationDecision.parse({
  ...EXAMPLE_MODERATION_DECISION,
  disposition: 'escalate_to_human',
  confidence: 0.4,
  departs_from_precedent: true,
  rationale: 'Ambiguous — retrieval confidence low; escalated to a human moderator.',
})

test('an approve decision renders the Approve label with rounded confidence', async () => {
  const screen = await render(<DecisionCard decision={approve} />)

  // `exact` — the disposition badge text would otherwise also match its substring in the rationale.
  await expect.element(screen.getByText('Approve', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('97% confidence')).toBeVisible()
})

test('a remove decision renders its cited rules and precedents', async () => {
  const screen = await render(<DecisionCard decision={remove} />)

  await expect.element(screen.getByText('Remove', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('no-harassment', { exact: true })).toBeVisible()
  await expect
    .element(screen.getByText('remove (no-harassment): a prior slur removal'))
    .toBeVisible()
})

test('an escalate decision flags a departure from precedent', async () => {
  const screen = await render(<DecisionCard decision={escalate} />)

  await expect.element(screen.getByText('Escalate', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('Departs from precedent')).toBeVisible()
})

test('a decision that follows precedent shows no departure flag', async () => {
  const screen = await render(<DecisionCard decision={approve} />)

  await expect.element(screen.getByText('Approve', { exact: true })).toBeVisible()
  expect(screen.getByText('Departs from precedent').query()).toBeNull()
})
