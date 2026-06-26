/// <reference types="@vitest/browser/matchers" />
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { WebhookForm } from './WebhookForm'

// Organism component test (ADR-0027, composition-delta model): the Input/Button atoms and FormField
// molecule WebhookForm composes are already proven, so these cover only what the FORM adds — the
// can-submit gate (URL + ≥1 event), the trimmed/shaped submit payload, the pending label, the alert.

const URL = 'https://hooks.example.com/qaroom'

test('submit stays disabled until both a URL and an event type are chosen', async () => {
  const screen = await render(<WebhookForm onSubmit={vi.fn()} />)
  const submit = screen.getByRole('button', { name: 'Register webhook' })

  await expect.element(submit).toBeDisabled()

  await screen.getByPlaceholder(URL).fill(URL)
  await expect.element(submit).toBeDisabled()

  await screen.getByRole('checkbox', { name: 'post.created' }).click()
  await expect.element(submit).toBeEnabled()
})

test('submitting emits the trimmed URL and the selected event types in order', async () => {
  const onSubmit = vi.fn()
  const screen = await render(<WebhookForm onSubmit={onSubmit} />)

  await screen.getByPlaceholder(URL).fill(`  ${URL}  `)
  await screen.getByRole('checkbox', { name: 'post.created' }).click()
  await screen.getByRole('checkbox', { name: 'vote.cast' }).click()
  await screen.getByRole('button', { name: 'Register webhook' }).click()

  expect(onSubmit).toHaveBeenCalledWith({
    url: URL,
    event_types: ['post.created', 'vote.cast'],
  })
})

test('pending shows the registering label and disables submit', async () => {
  const screen = await render(<WebhookForm pending onSubmit={vi.fn()} />)
  const submit = screen.getByRole('button')

  await expect.element(submit).toBeDisabled()
  await expect.element(submit).toHaveTextContent('Registering')
})

test('an error is announced as an alert', async () => {
  const screen = await render(<WebhookForm error="must be a public https URL" onSubmit={vi.fn()} />)

  await expect.element(screen.getByRole('alert')).toHaveTextContent('must be a public https URL')
})

// Drives the de-select arm of `toggle` (`next.delete(type)`): the example tests only ever ADD an
// event type, so the second click — removing one already in the set — was the uncovered branch.
test('toggling an event type a second time removes it from the selection', async () => {
  const onSubmit = vi.fn()
  const screen = await render(<WebhookForm onSubmit={onSubmit} />)
  const box = screen.getByRole('checkbox', { name: 'post.created' })

  await box.click()
  await expect.element(box).toBeChecked()

  await box.click()
  await expect.element(box).not.toBeChecked()

  // and with nothing selected the submit gate is closed again
  await screen.getByPlaceholder(URL).fill(URL)
  await expect.element(screen.getByRole('button', { name: 'Register webhook' })).toBeDisabled()
})

// Drives the closed-gate arm of `if (canSubmit)`: a native form submission (independent of the
// disabled button) with an empty URL and no events must emit nothing — the example tests only reach
// the open-gate then-arm.
test('a native submit with the gate closed (no URL, no events) emits nothing', async () => {
  const onSubmit = vi.fn()
  const screen = await render(<WebhookForm onSubmit={onSubmit} />)

  screen.container.querySelector('form')?.requestSubmit()

  expect(onSubmit).not.toHaveBeenCalled()
})
