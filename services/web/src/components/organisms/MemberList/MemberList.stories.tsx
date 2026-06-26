import { EXAMPLE_MEMBERSHIP, Membership } from '@qaroom/contracts'
import preview from '../../../../.storybook/preview'
import { MemberList } from './MemberList'

// CSF Factory format (ADR-0027 §4). Organism tier — the populated/loading/empty states of the
// member roster; the Avatar/Badge/Skeleton atoms inside are already proven, so these stories test
// only the list's own composition (one row per membership, role badge included).
const meta = preview.meta({
  title: 'organisms/MemberList',
  component: MemberList,
  args: {
    members: [
      Membership.parse({ ...EXAMPLE_MEMBERSHIP, role: 'owner' }),
      Membership.parse(EXAMPLE_MEMBERSHIP),
    ],
  },
})

export const WithMembers = meta.story({})
export const Loading = meta.story({ args: { loading: true, members: [] } })
export const Empty = meta.story({ args: { members: [] } })
