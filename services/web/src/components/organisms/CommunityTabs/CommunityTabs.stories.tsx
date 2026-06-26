import { MemoryRouter } from 'react-router-dom'
import preview from '../../../../.storybook/preview'
import { CommunityTabs } from './CommunityTabs'

// CSF Factory format (ADR-0027 §4). Organism tier — the per-community tab navigation; the router
// links it renders are already proven primitives, so this story tests only the tab strip the
// organism ADDS. The MemoryRouter decorator supplies the routing context the NavLinks need.
const meta = preview.meta({
  title: 'organisms/CommunityTabs',
  component: CommunityTabs,
  args: { communityId: 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
})

export const Default = meta.story({})
