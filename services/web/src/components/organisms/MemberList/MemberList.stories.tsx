import { EXAMPLE_MEMBERSHIP, Membership } from '@qaroom/contracts'
import preview from '../../../../.storybook/preview'
import { MemberList } from './MemberList'

// CSF Factory format (ADR-0027 §4). Organism tier — the populated/loading/empty states of the
// member roster; the Avatar/Badge/Skeleton atoms inside are already proven, so these stories test
// only the list's own composition (one row per membership, role badge included).
// A roster keys its rows on `user_id`, so two members built from the same example collide into one
// React key: the suite printed "Encountered two children with the same key" on every run and still
// exited 0. A community cannot contain the same user twice, so the fixture was rendering an
// impossible state — the second id keeps the story a roster rather than a duplicate.
const SECOND_MEMBER_ID = 'user_01HZY0K7M3QF8VN2J5RX9TB4D2'

const meta = preview.meta({
  title: 'organisms/MemberList',
  component: MemberList,
  args: {
    members: [
      Membership.parse({ ...EXAMPLE_MEMBERSHIP, role: 'owner' }),
      Membership.parse({ ...EXAMPLE_MEMBERSHIP, user_id: SECOND_MEMBER_ID }),
    ],
  },
})

export const WithMembers = meta.story({})
export const Loading = meta.story({ args: { loading: true, members: [] } })
export const Empty = meta.story({ args: { members: [] } })
