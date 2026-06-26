/// <reference types="@vitest/browser/matchers" />
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { Select } from './Select'

// Atom component test (ADR-0027, composition-delta model). Over a bare <select> the Select atom ADDS
// the `invalid` -> aria-invalid mapping and forwards selection through to its child <option>s. Those
// are what this test covers; the token styling is not behaviour. Browser required.

test('selecting an option updates the value', async () => {
  const screen = await render(
    <Select aria-label="Role">
      <option value="member">member</option>
      <option value="moderator">moderator</option>
      <option value="owner">owner</option>
    </Select>,
  )
  const field = screen.getByRole('combobox', { name: 'Role' })

  await field.selectOptions('moderator')

  await expect.element(field).toHaveValue('moderator')
})

test('invalid marks the select aria-invalid', async () => {
  const screen = await render(
    <Select aria-label="Role" invalid>
      <option value="member">member</option>
    </Select>,
  )

  await expect
    .element(screen.getByRole('combobox', { name: 'Role' }))
    .toHaveAttribute('aria-invalid', 'true')
})
