import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { Masthead } from './Masthead'

const meta = {
  title: 'organisms/Masthead',
  component: Masthead,
  args: {
    currentUser: { id: 'user_1', handle: 'ada', display_name: 'Ada Lovelace' },
    communities: [
      { id: 'comm_1', slug: 'general', name: 'General' },
      { id: 'comm_2', slug: 'dev', name: 'Developers' },
    ],
    theme: 'light',
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
} satisfies Meta<typeof Masthead>

export default meta
type Story = StoryObj<typeof meta>

export const SignedIn: Story = {}
export const SignedOut: Story = { args: { currentUser: null, communities: [] } }
