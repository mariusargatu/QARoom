/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { FormField } from './FormField'

// Molecule component test (ADR-0027, composition-delta): FormField is the labelled-control wrapper.
// Its delta is the implicit label→control association (the wrapped control gets its accessible name)
// and the `role="alert"` error text. The wrapped control's own behavior is not exercised here.

test('the label names its wrapped control', async () => {
  const screen = await render(
    <FormField label="Handle">
      <input data-testid="handle" />
    </FormField>,
  )

  await expect.element(screen.getByLabelText('Handle')).toHaveAttribute('data-testid', 'handle')
})

test('an error message is surfaced as an alert', async () => {
  const screen = await render(
    <FormField label="Handle" error="must be lowercase alphanumeric + underscore">
      <input />
    </FormField>,
  )

  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('must be lowercase alphanumeric + underscore')
})
