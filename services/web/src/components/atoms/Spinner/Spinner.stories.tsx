import preview from '../../../../.storybook/preview'
import { Spinner } from './Spinner'

// CSF Factory format (ADR-0027 §4). Atom tier — the single default state this loading indicator ADDS;
// higher tiers that show a pending state with it don't re-test the spinner.
const meta = preview.meta({
  title: 'atoms/Spinner',
  component: Spinner,
})

export const Default = meta.story({})
