/// <reference types="@vitest/browser/matchers" />
import fc from 'fast-check'
import { expect, test, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { AddMemberForm } from './AddMemberForm'

// Organism component test (ADR-0027, composition-delta model): AddMemberForm composes the proven
// Input/Select/Button atoms + FormField molecule. These cover only what the ORGANISM adds — the
// trim-user-id-paired-with-picked-role submit payload, the user-id-required submit gate, the pending
// label, and surfacing an error. The child controls' own typing/selection behavior is not re-asserted.

test('submitting emits the trimmed user id and the picked role', async () => {
  const onSubmit = vi.fn()
  const screen = await render(<AddMemberForm onSubmit={onSubmit} />)

  await screen.getByPlaceholder('user_…').fill('  user_42  ')
  await screen.getByRole('combobox').selectOptions('moderator')
  await screen.getByRole('button', { name: 'Add member' }).click()

  expect(onSubmit.mock.calls).toEqual([[{ user_id: 'user_42', role: 'moderator' }]])
})

test('the add button is gated until a user id is present', async () => {
  const screen = await render(<AddMemberForm onSubmit={vi.fn()} />)

  await expect.element(screen.getByRole('button', { name: 'Add member' })).toBeDisabled()

  await screen.getByPlaceholder('user_…').fill('user_9')

  await expect.element(screen.getByRole('button', { name: 'Add member' })).toBeEnabled()
})

test('while pending the submit control reads Adding and is disabled', async () => {
  const screen = await render(<AddMemberForm pending onSubmit={vi.fn()} />)

  await expect.element(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled()
})

test('an add error is surfaced as an alert', async () => {
  const screen = await render(
    <AddMemberForm error="User is already a member." onSubmit={vi.fn()} />,
  )

  await expect.element(screen.getByRole('alert')).toHaveTextContent('User is already a member.')
})

// Property: submitting the form emits EXACTLY when the gate is open — a non-blank user id AND not
// pending. Driving a native form submission (`requestSubmit`, independent of the disabled button)
// across the (id, pending) space exercises BOTH arms of `if (canSubmit)`: the example tests above
// only reach the then-arm. A blank-but-present id ('   ') closes the gate via the same trim the
// component uses; `examples` pins each gate corner so the else-arm is covered deterministically.
test('a native submit emits iff the gate is open (non-blank user id and not pending)', () => {
  return fc.assert(
    fc.asyncProperty(fc.constantFrom('   ', 'user_7'), fc.boolean(), async (userId, pending) => {
      const onSubmit = vi.fn()
      const screen = await render(<AddMemberForm pending={pending} onSubmit={onSubmit} />)
      await screen.getByPlaceholder('user_…').fill(userId)

      screen.container.querySelector('form')?.requestSubmit()

      const open = userId.trim().length > 0 && !pending
      expect(onSubmit).toHaveBeenCalledTimes(Number(open))

      await cleanup()
    }),
    {
      numRuns: 16,
      examples: [
        ['user_7', false],
        ['   ', false],
        ['user_7', true],
        ['   ', true],
      ],
    },
  )
})
