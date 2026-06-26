import { MemoryRouter } from 'react-router-dom'
import preview from '../../../../.storybook/preview'
import { Masthead } from './Masthead'

// CSF Factory format (ADR-0027 §4). Organism tier — the signed-in vs signed-out top bar; the
// Avatar/Button atoms and MenuDropdown molecule inside are already proven, so these stories test
// only the masthead's own composition. The MemoryRouter decorator supplies routing for its links.
const meta = preview.meta({
  title: 'organisms/Masthead',
  component: Masthead,
  // Common args live in meta; each story supplies the required `currentUser` + `communities` so the
  // factory's args type is satisfied per story (a story call cannot be empty when meta provides all).
  args: {
    theme: 'light' as const,
    onToggleTheme: () => {},
    onSignOut: () => {},
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
})

export const SignedIn = meta.story({
  args: {
    currentUser: { id: 'user_1', handle: 'ada', display_name: 'Ada Lovelace' },
    communities: [
      { id: 'comm_1', slug: 'general', name: 'General' },
      { id: 'comm_2', slug: 'dev', name: 'Developers' },
    ],
  },
})
export const SignedOut = meta.story({ args: { currentUser: null, communities: [] } })
