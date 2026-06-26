/// <reference types="@vitest/browser/matchers" />
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SortTabs } from './SortTabs'

// Molecule component test (ADR-0027, composition-delta): SortTabs is the segmented control; this
// covers only its own behavior — marking the active option with `aria-pressed` and emitting the
// clicked option's value through `onChange`.

const OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'top', label: 'Top' },
]

test('the active option is marked with aria-pressed', async () => {
  const screen = await render(<SortTabs options={OPTIONS} value="new" onChange={() => {}} />)

  await expect
    .element(screen.getByRole('button', { name: 'New' }))
    .toHaveAttribute('aria-pressed', 'true')
  await expect
    .element(screen.getByRole('button', { name: 'Top' }))
    .toHaveAttribute('aria-pressed', 'false')
})

test('clicking an option calls onChange with its value', async () => {
  const onChange = vi.fn()
  const screen = await render(<SortTabs options={OPTIONS} value="new" onChange={onChange} />)

  await screen.getByRole('button', { name: 'Top' }).click()

  expect(onChange).toHaveBeenCalledWith('top')
})
