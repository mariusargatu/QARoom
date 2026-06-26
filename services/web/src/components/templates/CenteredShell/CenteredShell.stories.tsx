import preview from '../../../../.storybook/preview'
import { CenteredShell } from './CenteredShell'

// CSF Factory format (ADR-0027 §4). Template tier — the full-viewport centered frame for the
// login / identity-picker screen. The card placed inside is already proven at lower tiers, so this
// story tests only the layout the shell ADDS, not its contents.
const meta = preview.meta({
  title: 'templates/CenteredShell',
  component: CenteredShell,
  args: {
    children: <div className="rounded-lg border border-border bg-surface p-6">Login card</div>,
  },
})

export const Default = meta.story({})
