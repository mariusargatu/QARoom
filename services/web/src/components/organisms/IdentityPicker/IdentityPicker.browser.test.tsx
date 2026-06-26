/// <reference types="@vitest/browser/matchers" />
import fc from 'fast-check'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { IdentityPicker } from './IdentityPicker'

// Organism component test (ADR-0027, composition-delta model): IdentityPicker composes the proven
// Avatar/Button/Card/Input atoms + FormField molecule. These cover only what the ORGANISM adds —
// routing a remembered-identity click to the right user id, the create-form trim + validity gate,
// and surfacing a sign-up error — not the child inputs' own behavior.

const KNOWN = [
  { id: 'user_01', handle: 'ada', display_name: 'Ada Lovelace' },
  { id: 'user_02', handle: 'grace', display_name: 'Grace Hopper' },
]

test('picking a remembered identity signs in that exact user by id, not handle', async () => {
  const onSignIn = vi.fn()
  const screen = await render(
    <IdentityPicker knownUsers={KNOWN} onSignIn={onSignIn} onSignUp={vi.fn()} />,
  )

  await screen.getByRole('button', { name: /Grace Hopper/ }).click()

  expect(onSignIn.mock.calls).toEqual([['user_02']])
})

test('creating an identity submits the trimmed handle and display name', async () => {
  const onSignUp = vi.fn()
  const screen = await render(
    <IdentityPicker knownUsers={[]} onSignIn={vi.fn()} onSignUp={onSignUp} />,
  )

  await screen.getByRole('textbox', { name: /Handle/ }).fill('  ada  ')
  await screen.getByRole('textbox', { name: /Display name/ }).fill('  Ada Lovelace  ')
  await screen.getByRole('button', { name: 'Enter' }).click()

  expect(onSignUp.mock.calls).toEqual([['ada', 'Ada Lovelace']])
})

test('the enter button is gated until both a valid handle and display name are present', async () => {
  const screen = await render(
    <IdentityPicker knownUsers={[]} onSignIn={vi.fn()} onSignUp={vi.fn()} />,
  )

  await expect.element(screen.getByRole('button', { name: 'Enter' })).toBeDisabled()

  await screen.getByRole('textbox', { name: /Handle/ }).fill('ab')
  await screen.getByRole('textbox', { name: /Display name/ }).fill('A')

  await expect.element(screen.getByRole('button', { name: 'Enter' })).toBeEnabled()
})

// Property over the `pending` prop: the submit button's label tracks the in-flight state as a law —
// 'Entering…' while a sign-up is pending, 'Enter' otherwise. Covers both arms of the label ternary.
test('the submit button label reflects the pending prop for either value', async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (pending) => {
      const screen = await render(
        <IdentityPicker knownUsers={[]} pending={pending} onSignIn={vi.fn()} onSignUp={vi.fn()} />,
      )
      const expectedLabel = pending ? 'Entering…' : 'Enter'

      await expect.element(screen.getByRole('button', { name: expectedLabel })).toBeVisible()

      await screen.unmount()
    }),
    { numRuns: 6 },
  )
})

// The disabled submit button blocks a click/Enter when the fields are invalid, so the onSubmit
// `if (canCreate)` re-check only ever defends a PROGRAMMATIC submit. Dispatching a submit event with
// empty fields drives exactly that defended path: canCreate is false, so onSignUp must NOT fire.
test('a programmatic submit with empty fields does not sign up (the canCreate guard holds)', async () => {
  const onSignUp = vi.fn()
  await render(<IdentityPicker knownUsers={[]} onSignIn={vi.fn()} onSignUp={onSignUp} />)

  const form = document.querySelector('form') as HTMLFormElement
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

  expect(onSignUp).not.toHaveBeenCalled()
})

test('a sign-up error is surfaced as an alert', async () => {
  const screen = await render(
    <IdentityPicker
      knownUsers={[]}
      error="Community slug already taken."
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
    />,
  )

  await expect.element(screen.getByRole('alert')).toHaveTextContent('Community slug already taken.')
})
