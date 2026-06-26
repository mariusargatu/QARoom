import { clickTheButton, theClickCount } from '@qaroom/testing-utils/screenplay'
import { createComponentActor } from '@qaroom/testing-utils/screenplay-ct'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'
import { ClickProbe } from '../../../test-support/click-probe'

// Broken-atom demo (ADR-0027, supersedes ADR-0005 exit criterion 4): the SAME Screenplay vocabulary
// that drives the system tests asserts here that the Button ATOM dispatches its click. The actor
// clicks via the clickTheButton Task and reads theClickCount Question. Deliberately break Button (drop
// `{...rest}` so onClick never reaches the DOM <button>) and the count stays 0 → this test fails,
// naming the atom + Task + Question. Browser required.
test('the Button atom dispatches its click in component context', async () => {
  const screen = await render(<ClickProbe />)
  const actor = createComponentActor(screen, 'Dana')

  expect(await actor.asks(theClickCount())).toBe(0)
  await actor.attemptsTo(clickTheButton())
  expect(await actor.asks(theClickCount())).toBe(1)
})
