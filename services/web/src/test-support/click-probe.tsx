import { TESTID } from '@qaroom/testing-utils/screenplay'
import { useState } from 'react'
import { Button } from '../components/atoms/Button'

/**
 * Harness for the Milestone-8 broken-atom component test (ADR-0005). Wires the raw `Button` atom's
 * onClick to a visible counter, so a Screenplay Question can assert the click DISPATCHED through the
 * DOM. If Button stops forwarding `{...rest}` (the deliberate break), its onClick never reaches the
 * real `<button>`, the counter stays 0, and the CT Task asserting `theClickCount()` fails.
 */
export function ClickProbe() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <Button data-testid={TESTID.buttonUnderTest} onClick={() => setCount((c) => c + 1)}>
        Click me
      </Button>
      <span data-testid={TESTID.buttonClickCount}>{count}</span>
    </div>
  )
}
