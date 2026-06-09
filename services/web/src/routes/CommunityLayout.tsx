import { Outlet, useParams } from 'react-router-dom'
import { CommunityTabs } from '../components/organisms/CommunityTabs'
import { useSession } from '../session/SessionProvider'

/** Layout for a single community: its header + section tabs, then the routed sub-page. */
export function CommunityLayout() {
  const { communityId = '' } = useParams()
  const { knownCommunities } = useSession()
  const community = knownCommunities.find((c) => c.id === communityId)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl font-medium text-text">
          {community?.name ?? 'Community'}
        </h1>
        <p className="text-xs text-muted">/{community?.slug ?? communityId}</p>
      </div>
      <CommunityTabs communityId={communityId} />
      <Outlet />
    </div>
  )
}
