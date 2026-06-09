import { useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useWsConnector } from '../../../hooks/useWsConnector'
import { useWsWithPollingFallback } from '../../../hooks/useWsWithPollingFallback'
import { useSession } from '../../../session/SessionProvider'
import { NotificationFeed } from '../../organisms/NotificationFeed'

/** Page: the live activity feed — real WebSocket push (ticket-authed) with a polling fallback. */
export function ActivityPage() {
  const { communityId = '' } = useParams()
  const { api, baseUrl } = useApi()
  const { token } = useSession()
  const connect = useWsConnector(api, baseUrl, token, communityId)
  const feed = useWsWithPollingFallback(api, communityId, { connect })

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-2xl font-medium text-text">Activity</h1>
      <NotificationFeed events={feed.events} live={feed.live} />
    </div>
  )
}
