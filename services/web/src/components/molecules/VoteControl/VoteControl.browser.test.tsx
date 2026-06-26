/// <reference types="@vitest/browser/matchers" />
import fc from 'fast-check'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { VoteControl, type VoteValue } from './VoteControl'

// Molecule component test (ADR-0027, composition-delta model): VoteControl composes two already-proven
// IconButton atoms; this test covers only what the MOLECULE adds — wiring up/down to ±1 and the
// pending lockout. Reference shape for molecule/atom behavior tests: render directly with vi.fn spies,
// locate by accessible role/name.

test('upvote and downvote emit +1 and -1', async () => {
  const onVote = vi.fn()
  const screen = await render(<VoteControl score={5} onVote={onVote} />)

  await screen.getByRole('button', { name: 'Upvote' }).click()
  await screen.getByRole('button', { name: 'Downvote' }).click()

  expect(onVote.mock.calls).toEqual([[1], [-1]])
})

test('pending disables both vote buttons', async () => {
  const screen = await render(<VoteControl score={5} pending onVote={vi.fn()} />)

  await expect.element(screen.getByRole('button', { name: 'Upvote' })).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Downvote' })).toBeDisabled()
})

// Property over the variant prop space (value × orientation): the score and the active direction
// carry the matching vote colour while the inactive controls stay muted, and the container's flex
// axis follows orientation. This closes the highlight branches (value 1/-1) and the horizontal
// orientation branch the example tests above leave to their defaults (value 0, vertical). Colour is
// the only observable of the highlight, so the invariant is asserted on the token classes per case.
// Total lookups over the finite key unions (a Record, not a Map — so access is `string`, never
// `string | undefined`, and needs no non-null assertion).
const SCORE_TINT: Record<VoteValue, string> = {
  1: 'text-upvote',
  [-1]: 'text-downvote',
  0: 'text-text',
}
const UP_TINT: Record<VoteValue, string> = {
  1: 'text-upvote',
  [-1]: 'text-muted',
  0: 'text-muted',
}
const DOWN_TINT: Record<VoteValue, string> = {
  1: 'text-muted',
  [-1]: 'text-downvote',
  0: 'text-muted',
}
const LAYOUT: Record<'vertical' | 'horizontal', { axis: string; other: string }> = {
  vertical: { axis: 'flex-col', other: 'flex-row' },
  horizontal: { axis: 'flex-row', other: 'flex-col' },
}

test('the active direction is highlighted and the flex axis follows orientation, per value', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom<VoteValue>(1, -1, 0),
      fc.constantFrom<'vertical' | 'horizontal'>('vertical', 'horizontal'),
      async (value, orientation) => {
        const screen = await render(
          <VoteControl score={5} value={value} orientation={orientation} onVote={vi.fn()} />,
        )
        const root = screen.container.firstElementChild as HTMLElement
        const score = screen.getByText('5').element()
        const up = screen.getByRole('button', { name: 'Upvote' }).element()
        const down = screen.getByRole('button', { name: 'Downvote' }).element()
        const layout = LAYOUT[orientation]

        expect(score.classList.contains(SCORE_TINT[value])).toBe(true)
        expect(up.classList.contains(UP_TINT[value])).toBe(true)
        expect(down.classList.contains(DOWN_TINT[value])).toBe(true)
        expect(root.classList.contains(layout.axis)).toBe(true)
        expect(root.classList.contains(layout.other)).toBe(false)

        await screen.unmount()
      },
    ),
    { seed: 7_274_736, numRuns: 36 },
  )
})
