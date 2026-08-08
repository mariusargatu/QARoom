import { useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useWsConnector } from '../../../hooks/useWsConnector'
import { useWsWithPollingFallback } from '../../../hooks/useWsWithPollingFallback'
import { useSession } from '../../../session/SessionProvider'
import { ErrorState } from '../../molecules/ErrorState'
import { NotificationFeed } from '../../organisms/NotificationFeed'

/** Page: the live activity feed — real WebSocket push (ticket-authed) with a polling fallback. */
export function ActivityPage() {
  const { communityId = '' } = useParams()
  const { api, baseUrl } = useApi()
  const { token } = useSession()
  const connect = useWsConnector(api, baseUrl, token, communityId)
  // The token is not optional in practice: ADR-0025 put the events route behind edge auth, so a
  // poll without it 401s and the Commitment-11 fallback quietly delivers nothing at all.
  const feed = useWsWithPollingFallback(api, communityId, { connect, token })

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-2xl font-medium text-text">Activity</h1>
      {/*
        A failing poll used to be invisible here — no error channel existed, so the page showed an
        empty feed and a reassuring badge while a rejection fired every two seconds.
      */}
      {feed.error ? <ErrorState message={`Activity is not updating: ${feed.error}`} /> : null}
      <NotificationFeed events={feed.events} live={feed.live} />
    </div>
  )
}
