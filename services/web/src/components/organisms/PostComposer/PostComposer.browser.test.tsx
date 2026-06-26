/// <reference types="@vitest/browser/matchers" />
import fc from 'fast-check'
import { expect, test, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { PostComposer } from './PostComposer'

// Organism component test (ADR-0027, composition-delta model): PostComposer composes the proven
// Input/Textarea/Button atoms + FormField molecule. These cover only what the ORGANISM adds — the
// title-required submit gate, the trim-title / keep-body-raw submit payload, the pending label, and
// surfacing a submit error. The child controls' own typing behavior is not re-asserted.

test('submitting emits the trimmed title and the raw body', async () => {
  const onSubmit = vi.fn()
  const screen = await render(<PostComposer onSubmit={onSubmit} />)

  await screen.getByPlaceholder('An interesting title').fill('  My great post  ')
  await screen.getByPlaceholder('Share your thoughts…').fill('The body copy.')
  await screen.getByRole('button', { name: 'Post' }).click()

  expect(onSubmit.mock.calls).toEqual([[{ title: 'My great post', body: 'The body copy.' }]])
})

test('the post button is gated until a title is present', async () => {
  const screen = await render(<PostComposer onSubmit={vi.fn()} />)

  await expect.element(screen.getByRole('button', { name: 'Post' })).toBeDisabled()

  await screen.getByPlaceholder('An interesting title').fill('Hi')

  await expect.element(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
})

test('while pending the submit control reads Posting and is disabled', async () => {
  const screen = await render(<PostComposer pending onSubmit={vi.fn()} />)

  await expect.element(screen.getByRole('button', { name: 'Posting…' })).toBeDisabled()
})

test('a submit error is surfaced as an alert', async () => {
  const screen = await render(
    <PostComposer error="content-service is unreachable." onSubmit={vi.fn()} />,
  )

  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('content-service is unreachable.')
})

// Property: composing emits EXACTLY when the gate is open — a non-blank title AND not pending.
// Driving a native form submission (`requestSubmit`, independent of the disabled button) across the
// (title, pending) space exercises BOTH arms of `if (canSubmit)`; the example tests above only reach
// the then-arm. A blank-but-present title ('   ') closes the gate via the same trim the component
// uses; `examples` pins each gate corner so the else-arm is covered deterministically.
test('a native submit emits iff the gate is open (non-blank title and not pending)', () => {
  return fc.assert(
    fc.asyncProperty(fc.constantFrom('   ', 'Hi'), fc.boolean(), async (title, pending) => {
      const onSubmit = vi.fn()
      const screen = await render(<PostComposer pending={pending} onSubmit={onSubmit} />)
      await screen.getByPlaceholder('An interesting title').fill(title)

      screen.container.querySelector('form')?.requestSubmit()

      const open = title.trim().length > 0 && !pending
      expect(onSubmit).toHaveBeenCalledTimes(Number(open))

      await cleanup()
    }),
    {
      numRuns: 16,
      examples: [
        ['Hi', false],
        ['   ', false],
        ['Hi', true],
        ['   ', true],
      ],
    },
  )
})
