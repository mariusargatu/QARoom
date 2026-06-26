import preview from '../../../../.storybook/preview'
import { AppShell } from './AppShell'

// CSF Factory format (ADR-0027 §4). Template tier — pure layout with named slots; the atoms,
// molecules, and organisms that fill those slots are already proven below, so this story tests
// only what the shell ADDS: the masthead-over-centered-column frame, not its contents.
const meta = preview.meta({
  title: 'templates/AppShell',
  component: AppShell,
  args: {
    masthead: (
      <div className="border-b border-border bg-bg px-4 py-4 font-display text-xl">QARoom</div>
    ),
    children: <div className="text-sm">Routed content</div>,
  },
})

export const Default = meta.story({})
